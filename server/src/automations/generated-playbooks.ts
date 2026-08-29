import { createHash } from "node:crypto";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import type { RunStep } from "../playbooks/distill.js";
import type { PlaybookLearningOutcome } from "../playbooks/learning.js";
import { listPeople, resolvePerson } from "../apps/people.js";
import { scrubSecrets } from "../security/scrub.js";
import type { Db } from "../state/db.js";
import type { AutomationPlaybookService } from "./playbooks.js";
import { renderApprovedStepManifest, type AutomationApprovedActionSnapshot } from "./types.js";

export type GeneratedPlaybookStatus = "observing" | "proposed" | "validating" | "active" | "failed";

export type GeneratedActionDefinition = {
  schemaVersion: 1;
  kind: "tool_action";
  action: {
    tool: "instagram_open_chat";
    personId: string;
    displayName: string;
    expectedUsername: string;
  };
};

export type GeneratedSequenceStep =
  | {
      id: string;
      tool: "chrome_open_url";
      url: string;
    }
  | {
      id: string;
      tool: "chrome_google_search" | "chrome_youtube_search";
      query: string;
    }
  | {
      id: string;
      tool: "instagram_open_chat" | "instagram_read_chat";
      personId: string;
      displayName: string;
      expectedUsername: string;
    };

export type GeneratedSequenceDefinition = {
  schemaVersion: 2;
  kind: "tool_sequence";
  steps: GeneratedSequenceStep[];
};

export type GeneratedPlaybookDefinition = GeneratedActionDefinition | GeneratedSequenceDefinition;

export type GeneratedPlaybookCandidate = {
  id: string;
  fingerprint: string;
  playbookId: string;
  revision: number;
  status: GeneratedPlaybookStatus;
  version: number;
  displayName: string;
  triggerPhrases: string[];
  definition: GeneratedPlaybookDefinition;
  evidenceTaskIds: string[];
  evidenceCount: number;
  validationRunId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  activatedAt: number | null;
};

type CandidateRow = {
  id: string; fingerprint: string; playbook_id: string; revision: number;
  status: GeneratedPlaybookStatus; version: number; display_name: string;
  trigger_phrases: string; definition: string; evidence_task_ids: string;
  evidence_count: number; validation_run_id: string | null; error_code: string | null;
  error_message: string | null; created_at: number; updated_at: number;
  approved_at: number | null; activated_at: number | null;
};

export type GeneratedPlaybookActionResult = {
  ok: boolean;
  text: string;
  verification?: ToolVerificationEvidence;
  steps?: Array<{
    id: string;
    tool: GeneratedSequenceStep["tool"];
    ok: boolean;
    summary: string;
    verification?: ToolVerificationEvidence;
  }>;
};

export class GeneratedPlaybookError extends Error {
  constructor(readonly code: string, message: string) {
    super(scrubSecrets(message));
    this.name = "GeneratedPlaybookError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 32) : [];
  } catch { return []; }
}

function safeString(value: unknown, max: number): string {
  return typeof value === "string" ? scrubSecrets(value).replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanLiteral(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function parseInstagramStep(value: unknown, id: string, tools: readonly string[]): GeneratedSequenceStep | null {
  if (!value || typeof value !== "object") return null;
  const step = value as Record<string, unknown>;
  if (!tools.includes(String(step.tool)) || step.id !== id || typeof step.personId !== "string" || !step.personId ||
      typeof step.displayName !== "string" || !step.displayName || step.displayName.length > 100 ||
      typeof step.expectedUsername !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(step.expectedUsername)) return null;
  return {
    id,
    tool: step.tool as "instagram_open_chat" | "instagram_read_chat",
    personId: step.personId.slice(0, 80),
    displayName: scrubSecrets(step.displayName).slice(0, 100),
    expectedUsername: step.expectedUsername.toLowerCase(),
  };
}

function parseSequenceStep(value: unknown, index: number): GeneratedSequenceStep | null {
  if (!value || typeof value !== "object") return null;
  const step = value as Record<string, unknown>;
  const id = `step-${index + 1}`;
  const instagram = parseInstagramStep(step, id, ["instagram_open_chat", "instagram_read_chat"]);
  if (instagram) return instagram;
  if (step.id !== id) return null;
  if (step.tool === "chrome_open_url") {
    const raw = cleanLiteral(step.url, 2_048);
    try {
      const url = new URL(raw);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password ||
          scrubSecrets(url.toString()) !== url.toString()) return null;
      return { id, tool: "chrome_open_url", url: url.toString() };
    } catch { return null; }
  }
  if (step.tool === "chrome_google_search" || step.tool === "chrome_youtube_search") {
    const query = cleanLiteral(step.query, 500);
    if (!query || scrubSecrets(query) !== query) return null;
    return { id, tool: step.tool, query };
  }
  return null;
}

function parseDefinition(value: string): GeneratedPlaybookDefinition {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new GeneratedPlaybookError("invalid_definition", "The generated playbook definition is not valid JSON"); }
  const definition = parsed as Partial<GeneratedPlaybookDefinition>;
  if (definition.schemaVersion === 1 && definition.kind === "tool_action") {
    const action = definition.action as Partial<GeneratedActionDefinition["action"]> | undefined;
    if (action?.tool !== "instagram_open_chat" || typeof action.personId !== "string" || !action.personId ||
        typeof action.displayName !== "string" || !action.displayName || action.displayName.length > 100 ||
        typeof action.expectedUsername !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(action.expectedUsername)) {
      throw new GeneratedPlaybookError("invalid_definition", "The generated playbook definition failed its bounded schema");
    }
    return { schemaVersion: 1, kind: "tool_action", action: {
      tool: "instagram_open_chat", personId: action.personId.slice(0, 80),
      displayName: scrubSecrets(action.displayName).slice(0, 100),
      expectedUsername: action.expectedUsername.toLowerCase(),
    } };
  }
  if (definition.schemaVersion === 2 && definition.kind === "tool_sequence" &&
      Array.isArray(definition.steps) && definition.steps.length >= 1 && definition.steps.length <= 6) {
    const steps = definition.steps.map((step, index) => parseSequenceStep(step, index));
    if (steps.every((step): step is GeneratedSequenceStep => step !== null)) {
      return { schemaVersion: 2, kind: "tool_sequence", steps };
    }
  }
  throw new GeneratedPlaybookError("invalid_definition", "The generated playbook definition failed its bounded schema");
}

function mapCandidate(row: CandidateRow): GeneratedPlaybookCandidate {
  return {
    id: row.id, fingerprint: row.fingerprint, playbookId: row.playbook_id,
    revision: row.revision, status: row.status, version: row.version,
    displayName: row.display_name, triggerPhrases: safeArray(row.trigger_phrases),
    definition: parseDefinition(row.definition), evidenceTaskIds: safeArray(row.evidence_task_ids),
    evidenceCount: row.evidence_count, validationRunId: row.validation_run_id,
    errorCode: row.error_code, errorMessage: row.error_message ? scrubSecrets(row.error_message) : null,
    createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at,
    activatedAt: row.activated_at,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}@._]+/gu, " ").trim();
}

function verifiedForLearning(step: RunStep): boolean {
  return step.ok && step.verification?.state === "verified";
}

function compileInstagramStep(memoryDir: string, step: RunStep, index: number): GeneratedSequenceStep | null {
  if (step.tool !== "instagram_open_chat" && step.tool !== "instagram_read_chat") return null;
  const rawArgs = step.args;
  const query = rawArgs && typeof rawArgs === "object" && "person" in rawArgs &&
    typeof (rawArgs as { person?: unknown }).person === "string"
    ? (rawArgs as { person: string }).person.trim() : "";
  const person = resolvePerson(memoryDir, query).person;
  const username = person?.instagram?.username?.toLowerCase().replace(/^@/, "") ?? "";
  if (!person || !username || !/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  return { id: `step-${index + 1}`, tool: step.tool, personId: person.id,
    displayName: person.name, expectedUsername: username };
}

function compileBrowserStep(step: RunStep, index: number): GeneratedSequenceStep | null {
  const args = step.args && typeof step.args === "object" ? step.args as Record<string, unknown> : {};
  const id = `step-${index + 1}`;
  if (step.tool === "chrome_google_search" || step.tool === "chrome_youtube_search") {
    const query = cleanLiteral(args.query, 500);
    return query && scrubSecrets(query) === query ? { id, tool: step.tool, query } : null;
  }
  if (step.tool === "chrome_open_url") {
    const raw = cleanLiteral(args.url, 2_048);
    try {
      const url = new URL(raw);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password ||
          scrubSecrets(url.toString()) !== url.toString()) return null;
      return { id, tool: "chrome_open_url", url: url.toString() };
    } catch { return null; }
  }
  return null;
}

export function generatedDefinitionSteps(definition: GeneratedPlaybookDefinition): GeneratedSequenceStep[] {
  if (definition.schemaVersion === 2) return definition.steps;
  return [{ id: "step-1", ...definition.action }];
}

export function generatedStepArgs(step: GeneratedSequenceStep): Record<string, unknown> {
  if (step.tool === "chrome_open_url") return { url: step.url };
  if ("query" in step) return { query: step.query };
  return { person: step.displayName };
}

function targetLabel(step: GeneratedSequenceStep): string {
  // Activepieces only needs an inspectable operation class plus the argument
  // fingerprint. Raw queries and people-map labels remain inside AVA.
  if ("displayName" in step) return step.tool === "instagram_open_chat"
    ? "Open a verified Instagram conversation"
    : "Read a verified Instagram conversation";
  if (step.tool === "chrome_open_url") return `Open ${new URL(step.url).hostname}`;
  return step.tool === "chrome_google_search" ? "Google search" : "YouTube search";
}

function compileCandidate(memoryDir: string, goal: string, steps: RunStep[]): {
  fingerprint: string; playbookId: string; displayName: string; triggerPhrases: string[];
  definition: GeneratedPlaybookDefinition;
} | null {
  if (!steps.length || steps.some((step) => !step.ok)) return null;
  const meaningful = steps.filter((step) => !["person_list", "instagram_status"].includes(step.tool));
  if (meaningful.length < 1 || meaningful.length > 6 || !meaningful.every(verifiedForLearning)) return null;
  const compiledSteps = meaningful.map((step, index) =>
    compileInstagramStep(memoryDir, step, index) ?? compileBrowserStep(step, index));
  if (!compiledSteps.every((step): step is GeneratedSequenceStep => step !== null)) return null;
  // Preserve the schema-v1 fingerprint/ID for the already-active Lasha family.
  // Every other supported procedure uses the general ordered sequence model.
  const only = compiledSteps[0];
  const definition: GeneratedPlaybookDefinition = compiledSteps.length === 1 && only?.tool === "instagram_open_chat"
    ? { schemaVersion: 1, kind: "tool_action", action: {
        tool: "instagram_open_chat", personId: only.personId,
        displayName: only.displayName, expectedUsername: only.expectedUsername,
      } }
    : { schemaVersion: 2, kind: "tool_sequence", steps: compiledSteps };
  const fingerprint = sha256(JSON.stringify(definition));
  const triggerPhrases = [...new Set([
    scrubSecrets(goal).trim().slice(0, 160),
    ...(definition.schemaVersion === 1 ? [
      `Open ${definition.action.displayName}'s Instagram chat`,
      `Open Instagram chat with ${definition.action.displayName}`,
      `Open @${definition.action.expectedUsername}'s Instagram chat`,
    ] : []),
  ].filter(Boolean))].slice(0, 6);
  return {
    fingerprint,
    playbookId: definition.schemaVersion === 1
      ? `ava.learned.instagram-open-chat.${fingerprint.slice(0, 12)}`
      : `ava.learned.sequence.${fingerprint.slice(0, 12)}`,
    displayName: definition.schemaVersion === 1
      ? `Open ${definition.action.displayName}'s Instagram chat`
      : safeString(goal, 120) || `${compiledSteps.length}-step approved automation`,
    triggerPhrases,
    definition,
  };
}

export class GeneratedPlaybookService {
  constructor(
    private readonly db: Db,
    private readonly automation: AutomationPlaybookService,
    private readonly memoryDir: string,
    private readonly executeAction: (
      definition: GeneratedPlaybookDefinition,
      signal?: AbortSignal,
      executionId?: string,
    ) => Promise<GeneratedPlaybookActionResult>,
  ) {
    const now = Date.now();
    db.prepare(`UPDATE automation_playbook_candidates SET status='failed', version=version+1,
      error_code='interrupted_by_restart', error_message='AVA restarted during Activepieces validation.',
      updated_at=? WHERE status='validating'`).run(now);
  }

  get(id: string): GeneratedPlaybookCandidate | null {
    const row = this.db.prepare("SELECT * FROM automation_playbook_candidates WHERE id=?")
      .get(id) as CandidateRow | undefined;
    return row ? mapCandidate(row) : null;
  }

  list(): GeneratedPlaybookCandidate[] {
    return (this.db.prepare("SELECT * FROM automation_playbook_candidates ORDER BY updated_at DESC, id")
      .all() as CandidateRow[]).map(mapCandidate);
  }

  active(): GeneratedPlaybookCandidate[] {
    return this.list().filter((candidate) => candidate.status === "active");
  }

  observeVerifiedRun(input: {
    taskId: string; goal: string; steps: RunStep[]; outcome: PlaybookLearningOutcome;
  }): GeneratedPlaybookCandidate | null {
    if (input.outcome !== "verified" || !/^[A-Za-z0-9_-]{4,160}$/.test(input.taskId)) return null;
    const compiled = compileCandidate(this.memoryDir, input.goal, input.steps);
    if (!compiled) return null;
    const existing = this.db.prepare("SELECT * FROM automation_playbook_candidates WHERE fingerprint=?")
      .get(compiled.fingerprint) as CandidateRow | undefined;
    const now = Date.now();
    if (!existing) {
      const id = `automation_candidate_${compiled.fingerprint.slice(0, 18)}`;
      this.db.prepare(`INSERT INTO automation_playbook_candidates
        (id,fingerprint,playbook_id,revision,status,version,display_name,trigger_phrases,definition,
         evidence_task_ids,evidence_count,created_at,updated_at)
        VALUES (?,?,?,1,'observing',1,?,?,?, ?,1,?,?)`).run(
          id, compiled.fingerprint, compiled.playbookId, compiled.displayName,
          JSON.stringify(compiled.triggerPhrases), JSON.stringify(compiled.definition),
          JSON.stringify([input.taskId]), now, now,
        );
      return this.get(id);
    }
    const evidence = safeArray(existing.evidence_task_ids);
    if (evidence.includes(input.taskId)) return mapCandidate(existing);
    const nextEvidence = [...evidence, input.taskId].slice(-32);
    const nextStatus = existing.status === "observing" && nextEvidence.length >= 2
      ? "proposed" : existing.status;
    this.db.prepare(`UPDATE automation_playbook_candidates SET status=?, version=version+1,
      trigger_phrases=?, evidence_task_ids=?, evidence_count=?, updated_at=? WHERE id=? AND version=?`).run(
        nextStatus, JSON.stringify([...new Set([...safeArray(existing.trigger_phrases), ...compiled.triggerPhrases])].slice(0, 8)),
        JSON.stringify(nextEvidence), nextEvidence.length, now, existing.id, existing.version,
      );
    return this.get(existing.id);
  }

  private revalidateIdentity(candidate: GeneratedPlaybookCandidate): void {
    for (const step of generatedDefinitionSteps(candidate.definition)) {
      if (step.tool !== "instagram_open_chat" && step.tool !== "instagram_read_chat") continue;
      const person = listPeople(this.memoryDir).find((item) => item.id === step.personId);
      const currentUsername = person?.instagram?.username?.toLowerCase().replace(/^@/, "") ?? "";
      if (!person || currentUsername !== step.expectedUsername) {
        throw new GeneratedPlaybookError(
          "identity_changed",
          `The people-map identity for ${step.displayName} changed after this playbook was learned; a fresh verified observation is required.`,
        );
      }
    }
  }

  private snapshot(candidate: GeneratedPlaybookCandidate): AutomationApprovedActionSnapshot {
    const evidenceFingerprint = sha256(JSON.stringify({
      definition: candidate.definition,
      taskIds: [...candidate.evidenceTaskIds].sort(),
    }));
    const definitionFingerprint = sha256(JSON.stringify(candidate.definition));
    const steps = generatedDefinitionSteps(candidate.definition).map((step) => ({
      id: step.id,
      tool: step.tool,
      targetLabel: targetLabel(step),
      targetFingerprint: sha256(JSON.stringify(step)),
    }));
    return {
      schemaVersion: 2,
      generatedAt: Date.now(), generatedAtIso: new Date().toISOString(),
      playbookId: candidate.playbookId, revision: candidate.revision,
      displayName: candidate.displayName,
      sequence: { kind: "tool_sequence", stepCount: steps.length, steps,
        renderedSteps: renderApprovedStepManifest(steps) },
      approval: { state: "approved", evidenceTaskCount: candidate.evidenceCount,
        evidenceFingerprint, definitionFingerprint },
    };
  }

  async activate(input: {
    candidateId: string; expectedVersion: number; parentRunId?: string | null; signal?: AbortSignal;
  }): Promise<GeneratedPlaybookCandidate> {
    const candidate = this.get(input.candidateId);
    if (!candidate) throw new GeneratedPlaybookError("candidate_not_found", "The automation playbook candidate does not exist");
    if (candidate.version !== input.expectedVersion) {
      throw new GeneratedPlaybookError("stale_candidate", `The candidate changed; current version is ${candidate.version}`);
    }
    if (candidate.status !== "proposed" && candidate.status !== "failed") {
      throw new GeneratedPlaybookError("invalid_candidate_state", `The candidate is ${candidate.status}, not awaiting activation`);
    }
    this.revalidateIdentity(candidate);
    const now = Date.now();
    const claimed = this.db.prepare(`UPDATE automation_playbook_candidates SET status='validating',
      version=version+1,error_code=NULL,error_message=NULL,approved_at=?,updated_at=?
      WHERE id=? AND version=? AND status IN ('proposed','failed')`).run(now, now, candidate.id, candidate.version);
    if (claimed.changes !== 1) throw new GeneratedPlaybookError("stale_candidate", "The candidate changed before validation started");
    const validating = this.get(candidate.id)!;
    try {
      const plan = await this.automation.run("ava.approved-action-plan", {
        requestKey: `candidate:${candidate.id}:revision:${candidate.revision}:version:${validating.version}`,
        parentRunId: input.parentRunId, signal: input.signal, snapshot: this.snapshot(validating),
      });
      if (plan.status !== "completed" || plan.verificationState !== "verified") {
        throw new GeneratedPlaybookError("activepieces_validation_failed", plan.errorMessage ?? `Validation ended ${plan.status}`);
      }
      this.revalidateIdentity(validating);
      const activatedAt = Date.now();
      const updated = this.db.prepare(`UPDATE automation_playbook_candidates SET status='active',
        version=version+1,validation_run_id=?,activated_at=?,updated_at=?
        WHERE id=? AND version=? AND status='validating'`).run(
          plan.id, activatedAt, activatedAt, validating.id, validating.version,
        );
      if (updated.changes !== 1) throw new GeneratedPlaybookError("stale_candidate", "The candidate changed before activation completed");
      return this.get(candidate.id)!;
    } catch (error) {
      const code = error instanceof GeneratedPlaybookError ? error.code : "activation_failed";
      const message = scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 500);
      this.db.prepare(`UPDATE automation_playbook_candidates SET status='failed',version=version+1,
        error_code=?,error_message=?,updated_at=? WHERE id=? AND status='validating'`).run(code, message, Date.now(), candidate.id);
      throw new GeneratedPlaybookError(code, message);
    }
  }

  async run(input: {
    playbookId: string; requestKey: string; parentRunId?: string | null; signal?: AbortSignal;
  }): Promise<{ candidate: GeneratedPlaybookCandidate; planRunId: string; result: GeneratedPlaybookActionResult }> {
    const row = this.db.prepare("SELECT * FROM automation_playbook_candidates WHERE playbook_id=? AND status='active'")
      .get(input.playbookId) as CandidateRow | undefined;
    if (!row) throw new GeneratedPlaybookError("playbook_unavailable", "The approved playbook is not active");
    const candidate = mapCandidate(row);
    this.revalidateIdentity(candidate);
    const plan = await this.automation.run("ava.approved-action-plan", {
      requestKey: `${input.requestKey}:plan`, parentRunId: input.parentRunId,
      signal: input.signal, snapshot: this.snapshot(candidate),
    });
    if (plan.status !== "completed" || plan.verificationState !== "verified") {
      throw new GeneratedPlaybookError("activepieces_plan_failed", plan.errorMessage ?? `Activepieces plan ended ${plan.status}`);
    }
    this.revalidateIdentity(candidate);
    const result = await this.executeAction(candidate.definition, input.signal, plan.id);
    return { candidate, planRunId: plan.id, result };
  }

  matchActive(prompt: string): GeneratedPlaybookCandidate | null {
    const query = normalize(prompt);
    if (!query) return null;
    const compoundRequest = /\b(?:and|then|after that|followed by)\b/.test(query);
    let best: { candidate: GeneratedPlaybookCandidate; score: number } | null = null;
    for (const candidate of this.active()) {
      const stepCount = generatedDefinitionSteps(candidate.definition).length;
      // A learned one-step procedure must never swallow an explicitly
      // compound request. The normal agent path needs to observe the complete
      // sequence before that sequence can become its own approved playbook.
      // Conversely, a multi-step procedure must never add its extra actions to
      // a simple one-action request merely because that request is a subset of
      // the longer learned trigger.
      if ((compoundRequest && stepCount === 1) || (!compoundRequest && stepCount > 1)) continue;
      const scores = candidate.triggerPhrases.map((phrase) => {
        const trigger = normalize(phrase);
        if (!trigger) return 0;
        if (query === trigger || query.includes(trigger) || trigger.includes(query)) return 100;
        const words = new Set(trigger.split(" ").filter((word) => word.length > 2));
        const hits = query.split(" ").filter((word) => words.has(word)).length;
        return words.size ? hits / words.size : 0;
      });
      const score = Math.max(...scores, 0);
      if (score >= 0.6 && (!best || score > best.score)) best = { candidate, score };
    }
    return best?.candidate ?? null;
  }
}
