import { scrubSecrets } from "../security/scrub.js";
import {
  AUTOMATION_WORKFLOWS,
  AUTOMATION_SCHEMA_VERSION,
  APPROVED_ACTION_PLAN_WORKFLOW,
  OPERATIONS_BRIEF_WORKFLOW,
  type AutomationApprovedActionSnapshot,
  type AutomationExecutor,
  type AutomationExecutorResult,
  type AutomationOperationsSnapshot,
  type AutomationProviderHealth,
  type AutomationSystemSnapshot,
  type AutomationWorkflowDefinition,
  type AutomationWorkflowHealth,
  type AutomationWorkflowId,
} from "./types.js";

export type ActivepiecesConfig = {
  enabled: boolean;
  systemReportWebhookUrl: string | null;
  operationsBriefWebhookUrl: string | null;
  approvedActionPlanWebhookUrl: string | null;
  webhookToken: string | null;
  timeoutMs: number;
};

export class AutomationExecutorError extends Error {
  constructor(readonly code: string, message: string) {
    super(scrubSecrets(message));
    this.name = "AutomationExecutorError";
  }
}

function cleanInline(value: unknown, max: number): string {
  return scrubSecrets(typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMarkdown(value: unknown): string {
  return scrubSecrets(typeof value === "string" ? value : "").replace(/\r\n/g, "\n").trim().slice(0, 50_000);
}

export function parseAutomationExecutorResult(
  value: unknown,
  expected: { requestKey: string; workflowId: string; workflowVersion: number },
): AutomationExecutorResult {
  if (!value || typeof value !== "object") {
    throw new AutomationExecutorError("invalid_response", "Activepieces returned a non-object workflow result");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== AUTOMATION_SCHEMA_VERSION || raw.workflowId !== expected.workflowId ||
      raw.workflowVersion !== expected.workflowVersion || raw.requestKey !== expected.requestKey) {
    throw new AutomationExecutorError("response_identity_mismatch", "Activepieces returned a result for a different workflow, version, or AVA request");
  }
  if (raw.status !== "succeeded" && raw.status !== "failed") {
    throw new AutomationExecutorError("invalid_response", "Activepieces returned an unsupported workflow status");
  }
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length < 1 || rawSteps.length > 16) {
    throw new AutomationExecutorError("invalid_response", "Activepieces returned an invalid step count");
  }
  const seen = new Set<string>();
  const steps = rawSteps.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new AutomationExecutorError("invalid_response", "Activepieces returned a malformed step result");
    }
    const step = candidate as Record<string, unknown>;
    const id = cleanInline(step.id, 64);
    const status = step.status;
    const summary = cleanInline(step.summary, 500);
    const durationMs = step.durationMs === null || step.durationMs === undefined
      ? null : Number(step.durationMs);
    if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(id) || seen.has(id) ||
        (status !== "completed" && status !== "failed" && status !== "skipped") || !summary ||
        (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000))) {
      throw new AutomationExecutorError("invalid_response", "Activepieces returned an invalid or duplicate step result");
    }
    seen.add(id);
    return { id, status, summary, durationMs } as const;
  });
  const externalRunId = raw.externalRunId === null || raw.externalRunId === undefined
    ? null : cleanInline(raw.externalRunId, 160);
  const providerVersion = raw.providerVersion === null || raw.providerVersion === undefined
    ? null : cleanInline(raw.providerVersion, 80);
  if ((raw.externalRunId != null && !externalRunId) || (raw.providerVersion != null && !providerVersion)) {
    throw new AutomationExecutorError("invalid_response", "Activepieces returned invalid provider identity evidence");
  }
  let report: AutomationExecutorResult["report"] = null;
  if (raw.report && typeof raw.report === "object") {
    const reportValue = raw.report as Record<string, unknown>;
    const title = cleanInline(reportValue.title, 160);
    const markdown = cleanMarkdown(reportValue.markdown);
    if (title && markdown) report = { title, markdown };
  }
  let error: AutomationExecutorResult["error"] = null;
  if (raw.error && typeof raw.error === "object") {
    const errorValue = raw.error as Record<string, unknown>;
    const code = cleanInline(errorValue.code, 64);
    const message = cleanInline(errorValue.message, 500);
    if (code && message) error = { code, message };
  }
  if (raw.status === "succeeded" && (!report || steps.some((step) => step.status === "failed"))) {
    throw new AutomationExecutorError("invalid_response", "Activepieces claimed success without a complete report and successful step evidence");
  }
  if (raw.status === "failed" && !error) {
    throw new AutomationExecutorError("invalid_response", "Activepieces reported failure without a bounded error");
  }
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    workflowId: expected.workflowId,
    workflowVersion: expected.workflowVersion,
    requestKey: expected.requestKey,
    externalRunId,
    providerVersion,
    status: raw.status,
    steps,
    report,
    error,
    usage: "not_reported",
    cost: "not_reported",
  };
}

function validatedWebhookUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

export class ActivepiecesWebhookExecutor implements AutomationExecutor {
  readonly id = "activepieces" as const;
  private readonly webhookUrls: Record<AutomationWorkflowId, URL | null>;

  constructor(
    private readonly config: ActivepiecesConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.webhookUrls = {
      "ava.system-report": validatedWebhookUrl(config.systemReportWebhookUrl),
      "ava.operations-brief": validatedWebhookUrl(config.operationsBriefWebhookUrl),
      "ava.approved-action-plan": validatedWebhookUrl(config.approvedActionPlanWebhookUrl),
    };
  }

  health(): AutomationProviderHealth {
    const workflows = AUTOMATION_WORKFLOWS.map((workflow) => this.workflowHealth(workflow));
    const configuredCount = workflows.filter((workflow) => workflow.configured).length;
    const configured = configuredCount > 0;
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      provider: "activepieces",
      configured,
      available: configured,
      executionMode: configured ? "sync_webhook" : "unavailable",
      reason: !this.config.enabled
        ? "Activepieces automation is disabled."
        : configuredCount === workflows.length
          ? `All ${workflows.length} pinned Activepieces playbooks are configured; availability is confirmed by each bounded invocation.`
          : `${configuredCount} of ${workflows.length} pinned Activepieces playbooks are configured.`,
      workflows,
      timeoutMs: this.config.timeoutMs,
      runtimeEvidence: configured ? "configured_endpoint" : "missing_configuration",
      usage: "not_reported",
      cost: "not_reported",
    };
  }

  workflowHealth(workflow: AutomationWorkflowDefinition): AutomationWorkflowHealth {
    const webhook = this.webhookUrls[workflow.id];
    const configured = this.config.enabled && webhook !== null;
    return {
      workflow,
      configured,
      available: configured,
      reason: !this.config.enabled
        ? "Activepieces automation is disabled."
        : !webhook
          ? `The pinned ${workflow.id} webhook is not configured or is invalid.`
          : `The pinned ${workflow.id} webhook is configured; availability is confirmed by each bounded invocation.`,
      runtimeEvidence: configured ? "configured_endpoint" : "missing_configuration",
    };
  }

  async execute(input: Parameters<AutomationExecutor["execute"]>[0]): Promise<AutomationExecutorResult> {
    const workflow = AUTOMATION_WORKFLOWS.find((candidate) => candidate.id === input.workflowId);
    if (!workflow) throw new AutomationExecutorError("workflow_not_registered", "AVA rejected an unregistered automation workflow");
    const health = this.workflowHealth(workflow);
    const webhookUrl = this.webhookUrls[workflow.id];
    if (!health.available || !webhookUrl) {
      throw new AutomationExecutorError("activepieces_unavailable", health.reason);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Activepieces workflow timed out")), this.config.timeoutMs);
    const abort = () => controller.abort(input.signal.reason ?? new Error("AVA task cancelled"));
    if (input.signal.aborted) abort();
    else input.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ava-request-id": input.requestKey,
          ...(this.config.webhookToken ? { authorization: `Bearer ${this.config.webhookToken}` } : {}),
        },
        body: JSON.stringify({
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          workflowId: input.workflowId,
          workflowVersion: input.workflowVersion,
          requestKey: input.requestKey,
          snapshot: input.snapshot,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AutomationExecutorError(
          response.status === 408 ? "activepieces_timeout" : "activepieces_http_error",
          `Activepieces ${workflow.id} webhook returned HTTP ${response.status}`,
        );
      }
      const text = await response.text();
      if (text.length > 100_000) throw new AutomationExecutorError("response_too_large", "Activepieces workflow response exceeded 100 KB");
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { throw new AutomationExecutorError("invalid_response", "Activepieces returned invalid JSON"); }
      return parseAutomationExecutorResult(parsed, input);
    } catch (error) {
      if (error instanceof AutomationExecutorError) throw error;
      if (controller.signal.aborted) {
        const cancelled = input.signal.aborted;
        throw new AutomationExecutorError(cancelled ? "cancelled" : "activepieces_timeout",
          cancelled ? "AVA cancelled the Activepieces workflow" : "Activepieces workflow exceeded its bounded timeout");
      }
      throw new AutomationExecutorError("activepieces_unreachable", error instanceof Error ? error.message : "Activepieces request failed");
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", abort);
    }
  }
}

export function renderFixtureSystemReport(snapshot: AutomationSystemSnapshot): string {
  const yesNo = (value: boolean) => value ? "Ready" : "Unavailable";
  return [
    "# AVA System Health Report",
    "",
    `Generated: ${snapshot.generatedAtIso}`,
    "",
    "## Core",
    "",
    `- Overall: ${yesNo(snapshot.ready)}`,
    `- Brain: ${yesNo(snapshot.core.brainReady)}${snapshot.provider ? ` (${snapshot.provider})` : ""}`,
    `- Voice: ${yesNo(snapshot.core.voiceReady)}`,
    `- Browser: ${yesNo(snapshot.core.browserReady)}`,
    `- Memory: ${yesNo(snapshot.core.memoryReady)}`,
    "",
    "## Durable state",
    "",
    `- Preferences: ${snapshot.counts.preferences}`,
    `- Observations: ${snapshot.counts.observations}`,
    `- Projects: ${snapshot.counts.projects}`,
    `- People: ${snapshot.counts.people}`,
    `- Learned playbooks: ${snapshot.counts.playbooks}`,
    `- Enabled watches: ${snapshot.counts.watches}`,
    "",
    "## Integrations",
    "",
    ...Object.entries(snapshot.integrations).map(([name, ready]) => `- ${name}: ${yesNo(ready)}`),
    "",
    "This report contains bounded readiness facts supplied by AVA. Activepieces does not receive credentials or raw memory contents.",
  ].join("\n");
}

export function renderFixtureOperationsBrief(snapshot: AutomationOperationsSnapshot): string {
  return [
    "# AVA Operations Brief",
    "",
    `Generated: ${snapshot.generatedAtIso}`,
    "",
    "## Readiness",
    "",
    `- Overall ready: ${snapshot.readiness.ready}`,
    `- Provider: ${snapshot.readiness.provider ?? "not configured"}`,
    `- Brain / voice / browser / memory: ${snapshot.readiness.brainReady} / ${snapshot.readiness.voiceReady} / ${snapshot.readiness.browserReady} / ${snapshot.readiness.memoryReady}`,
    "",
    "## Last 24 hours",
    "",
    `- Runs: ${snapshot.recentRuns.total}`,
    `- Active / completed / failed: ${snapshot.recentRuns.active} / ${snapshot.recentRuns.completed} / ${snapshot.recentRuns.failed}`,
    `- Cancelled / timed out: ${snapshot.recentRuns.cancelled} / ${snapshot.recentRuns.timedOut}`,
    `- Verified / not verified: ${snapshot.recentRuns.verified} / ${snapshot.recentRuns.notVerified}`,
    "",
    "## Attention",
    "",
    `- Pending approvals: ${snapshot.attention.pendingApprovals}`,
    `- Blocked Self improvements: ${snapshot.attention.blockedSelfImprovements}`,
    `- Blocked watcher successors: ${snapshot.attention.blockedWatcherSuccessors}`,
    "",
    "## Work and knowledge",
    "",
    `- Pinned / Doing / Review notes: ${snapshot.work.pinnedNotes} / ${snapshot.work.notesDoing} / ${snapshot.work.notesInReview}`,
    `- Active / shipped Self improvements: ${snapshot.work.activeSelfImprovements} / ${snapshot.work.shippedSelfImprovements}`,
    `- Enabled watches: ${snapshot.work.enabledWatches}`,
    `- Active memory entries / verified sources: ${snapshot.knowledge.activeMemoryEntries} / ${snapshot.knowledge.verifiedMemorySources}`,
    "",
    "This brief contains bounded operational counts supplied by AVA. Activepieces does not receive prompts, note bodies, memory content, credentials, or raw logs.",
  ].join("\n");
}

export function renderFixtureApprovedActionPlan(snapshot: AutomationApprovedActionSnapshot): string {
  return [
    "# AVA Approved Action Plan",
    "",
    `Generated: ${snapshot.generatedAtIso}`,
    "",
    "## Definition",
    "",
    `- Playbook: ${snapshot.playbookId}`,
    `- Revision: ${snapshot.revision}`,
    `- Name: ${snapshot.displayName}`,
    "",
    "## Approved steps",
    "",
    snapshot.sequence.renderedSteps,
    "",
    "## Evidence boundary",
    "",
    `- Approval: ${snapshot.approval.state}`,
    `- Verified source tasks: ${snapshot.approval.evidenceTaskCount}`,
    `- Evidence fingerprint: ${snapshot.approval.evidenceFingerprint}`,
    `- Definition fingerprint: ${snapshot.approval.definitionFingerprint}`,
    "",
    "Activepieces validated this bounded plan. AVA still owns identity revalidation, local execution, and outcome verification.",
  ].join("\n");
}

/** Deterministic real-shaped executor used only by tests and the opt-in smoke. */
export class DeterministicAutomationFixtureExecutor implements AutomationExecutor {
  readonly id = "deterministic_fixture" as const;
  constructor(private readonly behavior: "success" | "failure" = "success") {}
  health(): AutomationProviderHealth {
    const workflows = AUTOMATION_WORKFLOWS.map((workflow) => this.workflowHealth(workflow));
    return {
      schemaVersion: 1, provider: "activepieces", configured: true, available: true,
      executionMode: "sync_webhook", reason: "Deterministic test fixture available.",
      workflows, timeoutMs: 1_000,
      runtimeEvidence: "deterministic_fixture", usage: "not_reported", cost: "not_reported",
    };
  }
  workflowHealth(workflow: AutomationWorkflowDefinition): AutomationWorkflowHealth {
    return { workflow, configured: true, available: true, reason: "Deterministic test fixture available.",
      runtimeEvidence: "deterministic_fixture" };
  }
  async execute(input: Parameters<AutomationExecutor["execute"]>[0]): Promise<AutomationExecutorResult> {
    if (input.signal.aborted) throw new AutomationExecutorError("cancelled", "Fixture workflow was cancelled");
    if (this.behavior === "failure") {
      return { schemaVersion: 1, workflowId: input.workflowId, workflowVersion: input.workflowVersion,
        requestKey: input.requestKey, externalRunId: "fixture-run-failed", providerVersion: "fixture-v1",
        status: "failed", steps: [{ id: "build_report", status: "failed", summary: "Fixture report generation failed.", durationMs: 1 }],
        report: null, error: { code: "fixture_failure", message: "Fixture workflow failed deliberately." },
        usage: "not_reported", cost: "not_reported" };
    }
    const isOperations = input.workflowId === OPERATIONS_BRIEF_WORKFLOW.id;
    const isApprovedAction = input.workflowId === APPROVED_ACTION_PLAN_WORKFLOW.id;
    const report = isApprovedAction
      ? { title: "AVA Approved Action Plan", markdown: renderFixtureApprovedActionPlan(input.snapshot as AutomationApprovedActionSnapshot) }
      : isOperations
        ? { title: "AVA Operations Brief", markdown: renderFixtureOperationsBrief(input.snapshot as AutomationOperationsSnapshot) }
        : { title: "AVA System Health Report", markdown: renderFixtureSystemReport(input.snapshot as AutomationSystemSnapshot) };
    return { schemaVersion: 1, workflowId: input.workflowId, workflowVersion: input.workflowVersion,
      requestKey: input.requestKey, externalRunId: "fixture-run-success", providerVersion: "fixture-v1",
      status: "succeeded",
      steps: [
        { id: "accept_snapshot", status: "completed", summary: "Accepted the bounded AVA snapshot.", durationMs: 1 },
        { id: "build_report", status: "completed", summary: `Built the deterministic ${isApprovedAction ? "approved action plan" : isOperations ? "operations brief" : "health report"}.`, durationMs: 1 },
      ],
      report,
      error: null, usage: "not_reported", cost: "not_reported" };
  }
}
