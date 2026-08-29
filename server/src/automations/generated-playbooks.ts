import { createHash } from "node:crypto";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import type { RunStep } from "../playbooks/distill.js";
import type { PlaybookLearningOutcome } from "../playbooks/learning.js";
import { listPeople, resolvePerson } from "../apps/people.js";
import { scrubSecrets } from "../security/scrub.js";
import type { Db } from "../state/db.js";
import type { AutomationPlaybookService } from "./playbooks.js";
import type { AutomationApprovedActionSnapshot } from "./types.js";

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

export type GeneratedPlaybookCandidate = {
  id: string;
  fingerprint: string;
  playbookId: string;
  revision: number;
  status: GeneratedPlaybookStatus;
  version: number;
  displayName: string;
  triggerPhrases: string[];
  definition: GeneratedActionDefinition;
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

function parseDefinition(value: string): GeneratedActionDefinition {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new GeneratedPlaybookError("invalid_definition", "The generated playbook definition is not valid JSON"); }
  const definition = parsed as Partial<GeneratedActionDefinition>;
  const action = definition?.action as Partial<GeneratedActionDefinition["action"]> | undefined;
  if (definition.schemaVersion !== 1 || definition.kind !== "tool_action" ||
      action?.tool !== "instagram_open_chat" || typeof action.personId !== "string" || !action.personId ||
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

function compileCandidate(memoryDir: string, goal: string, steps: RunStep[]): {
  fingerprint: string; playbookId: string; displayName: string; triggerPhrases: string[];
  definition: GeneratedActionDefinition;
} | null {
  if (!steps.length || steps.some((step) => !step.ok)) return null;
  const meaningful = steps.filter((step) => !["person_list", "instagram_status"].includes(step.tool));
  if (meaningful.length !== 1 || meaningful[0]!.tool !== "instagram_open_chat") return null;
  const rawArgs = meaningful[0]!.args;
  const query = rawArgs && typeof rawArgs === "object" && "person" in rawArgs &&
    typeof (rawArgs as { person?: unknown }).person === "string"
    ? (rawArgs as { person: string }).person.trim() : "";
  const resolved = resolvePerson(memoryDir, query);
  const person = resolved.person;
  const username = person?.instagram?.username?.toLowerCase().replace(/^@/, "") ?? "";
  if (!person || !username || !/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  const definition: GeneratedActionDefinition = { schemaVersion: 1, kind: "tool_action", action: {
    tool: "instagram_open_chat", personId: person.id, displayName: person.name, expectedUsername: username,
  } };
  const fingerprint = sha256(JSON.stringify(definition));
  const triggerPhrases = [...new Set([
    scrubSecrets(goal).trim().slice(0, 160),
    `Open ${person.name}'s Instagram chat`,
    `Open Instagram chat with ${person.name}`,
    `Open @${username}'s Instagram chat`,
  ].filter(Boolean))].slice(0, 6);
  return {
    fingerprint,
    playbookId: `ava.learned.instagram-open-chat.${fingerprint.slice(0, 12)}`,
    displayName: `Open ${person.name}'s Instagram chat`,
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
      definition: GeneratedActionDefinition,
      signal?: AbortSignal,
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
    const action = candidate.definition.action;
    const person = listPeople(this.memoryDir).find((item) => item.id === action.personId);
    const currentUsername = person?.instagram?.username?.toLowerCase().replace(/^@/, "") ?? "";
    if (!person || currentUsername !== action.expectedUsername) {
      throw new GeneratedPlaybookError(
        "identity_changed",
        `The people-map identity for ${action.displayName} changed after this playbook was learned; a fresh verified observation is required.`,
      );
    }
  }

  private snapshot(candidate: GeneratedPlaybookCandidate): AutomationApprovedActionSnapshot {
    const evidenceFingerprint = sha256(JSON.stringify({
      definition: candidate.definition,
      taskIds: [...candidate.evidenceTaskIds].sort(),
    }));
    return {
      generatedAt: Date.now(), generatedAtIso: new Date().toISOString(),
      playbookId: candidate.playbookId, revision: candidate.revision,
      displayName: candidate.displayName,
      action: { tool: candidate.definition.action.tool, targetLabel: candidate.definition.action.displayName,
        targetIdentity: candidate.definition.action.expectedUsername },
      approval: { state: "approved", evidenceTaskCount: candidate.evidenceCount, evidenceFingerprint },
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
    const result = await this.executeAction(candidate.definition, input.signal);
    return { candidate, planRunId: plan.id, result };
  }

  matchActive(prompt: string): GeneratedPlaybookCandidate | null {
    const query = normalize(prompt);
    if (!query) return null;
    let best: { candidate: GeneratedPlaybookCandidate; score: number } | null = null;
    for (const candidate of this.active()) {
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
