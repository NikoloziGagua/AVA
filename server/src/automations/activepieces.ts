import { scrubSecrets } from "../security/scrub.js";
import {
  AUTOMATION_SCHEMA_VERSION,
  SYSTEM_REPORT_WORKFLOW,
  type AutomationExecutor,
  type AutomationExecutorResult,
  type AutomationProviderHealth,
  type AutomationSystemSnapshot,
} from "./types.js";

export type ActivepiecesConfig = {
  enabled: boolean;
  systemReportWebhookUrl: string | null;
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
  private readonly webhookUrl: URL | null;

  constructor(
    private readonly config: ActivepiecesConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.webhookUrl = validatedWebhookUrl(config.systemReportWebhookUrl);
  }

  health(): AutomationProviderHealth {
    const configured = this.config.enabled && this.webhookUrl !== null;
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      provider: "activepieces",
      configured,
      available: configured,
      executionMode: configured ? "sync_webhook" : "unavailable",
      reason: !this.config.enabled
        ? "Activepieces automation is disabled."
        : !this.webhookUrl
          ? "The pinned AVA system-report webhook is not configured or is invalid."
          : "The pinned Activepieces webhook is configured; availability is confirmed by each bounded invocation.",
      workflow: SYSTEM_REPORT_WORKFLOW,
      timeoutMs: this.config.timeoutMs,
      runtimeEvidence: configured ? "configured_endpoint" : "missing_configuration",
      usage: "not_reported",
      cost: "not_reported",
    };
  }

  async execute(input: Parameters<AutomationExecutor["execute"]>[0]): Promise<AutomationExecutorResult> {
    const health = this.health();
    if (!health.available || !this.webhookUrl) {
      throw new AutomationExecutorError("activepieces_unavailable", health.reason);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Activepieces workflow timed out")), this.config.timeoutMs);
    const abort = () => controller.abort(input.signal.reason ?? new Error("AVA task cancelled"));
    if (input.signal.aborted) abort();
    else input.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(this.webhookUrl, {
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
          `Activepieces system-report webhook returned HTTP ${response.status}`,
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
    `Generated: ${new Date(snapshot.generatedAt).toISOString()}`,
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

/** Deterministic real-shaped executor used only by tests and the opt-in smoke. */
export class DeterministicAutomationFixtureExecutor implements AutomationExecutor {
  readonly id = "deterministic_fixture" as const;
  constructor(private readonly behavior: "success" | "failure" = "success") {}
  health(): AutomationProviderHealth {
    return {
      schemaVersion: 1, provider: "activepieces", configured: true, available: true,
      executionMode: "sync_webhook", reason: "Deterministic test fixture available.",
      workflow: SYSTEM_REPORT_WORKFLOW, timeoutMs: 1_000,
      runtimeEvidence: "deterministic_fixture", usage: "not_reported", cost: "not_reported",
    };
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
    return { schemaVersion: 1, workflowId: input.workflowId, workflowVersion: input.workflowVersion,
      requestKey: input.requestKey, externalRunId: "fixture-run-success", providerVersion: "fixture-v1",
      status: "succeeded",
      steps: [
        { id: "accept_snapshot", status: "completed", summary: "Accepted the bounded AVA readiness snapshot.", durationMs: 1 },
        { id: "build_report", status: "completed", summary: "Built the deterministic Markdown health report.", durationMs: 1 },
      ],
      report: { title: "AVA System Health Report", markdown: renderFixtureSystemReport(input.snapshot) },
      error: null, usage: "not_reported", cost: "not_reported" };
  }
}
