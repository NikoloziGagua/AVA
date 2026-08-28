import { createHash } from "node:crypto";
import type { Db } from "../state/db.js";
import { sanitiseExplorerText, sanitiseExplorerValue } from "../explorer/redaction.js";
import type { ObservabilityService } from "../observability/store.js";

export const UFO_EXPERIMENT_SCHEMA_VERSION = 1;
export const UFO_FIXTURES = ["counter-v1"] as const;
export type UfoFixtureId = (typeof UFO_FIXTURES)[number];
export type UfoExperimentOperation = "observe" | "advance";
export type UfoExperimentStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type UfoExperimentConfig = {
  enabled: boolean;
  mode: "off" | "fixture" | "ufo";
  isolation: "none" | "synthetic-fixture-v1" | "disposable-windows-vm";
  allowFixtureActions: boolean;
  allowedFixtures: UfoFixtureId[];
  timeoutMs: number;
  maxSteps: number;
};

export type UfoExperimentHealth = {
  schemaVersion: 1;
  experimental: true;
  enabled: boolean;
  available: boolean;
  mode: UfoExperimentConfig["mode"];
  isolation: UfoExperimentConfig["isolation"];
  observeOnly: boolean;
  actionsAvailable: boolean;
  approvalRequiredForActions: true;
  allowedFixtures: UfoFixtureId[];
  limits: { timeoutMs: number; maxSteps: number };
  runtime: {
    adapter: "synthetic_fixture" | "microsoft_ufo" | "none";
    dependency: "available" | "not_checked" | "unavailable";
    reason: string;
  };
  nonGoals: string[];
};

export type UfoExperimentRequest = {
  requestKey: string;
  fixtureId: UfoFixtureId;
  operation: UfoExperimentOperation;
  expectedFixtureVersion?: number;
  maxSteps?: number;
};

export type UfoExperimentRecord = {
  id: string;
  requestKey: string;
  observabilityRunId: string;
  fixtureId: UfoFixtureId;
  operation: UfoExperimentOperation;
  status: UfoExperimentStatus;
  version: number;
  steps: number;
  maxSteps: number;
  inputSummary: unknown;
  outputSummary: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type UfoExperimentContext = {
  parentRunId?: string | null;
  sessionId?: string | null;
  signal?: AbortSignal;
};

type RequestRow = {
  id: string; request_key: string; observability_run_id: string; input_fingerprint: string;
  fixture_id: string; operation: string; status: string; version: number; steps: number;
  max_steps: number; input_summary: string; output_summary: string | null;
  error_code: string | null; error_message: string | null; created_at: number;
  updated_at: number; completed_at: number | null;
};

type FixtureRow = { fixture_id: string; value: number; version: number; updated_at: number };

export type UfoAdapterResult = {
  steps: number;
  observedValue: number;
  nextValue: number;
  summary: string;
};

export type UfoExperimentAdapter = {
  readonly id: "synthetic_fixture";
  execute(input: {
    fixtureId: UfoFixtureId;
    operation: UfoExperimentOperation;
    value: number;
    maxSteps: number;
    signal: AbortSignal;
  }): Promise<UfoAdapterResult>;
};

export class SyntheticFixtureAdapter implements UfoExperimentAdapter {
  readonly id = "synthetic_fixture" as const;

  async execute(input: Parameters<UfoExperimentAdapter["execute"]>[0]): Promise<UfoAdapterResult> {
    if (input.signal.aborted) throw new UfoExperimentError("cancelled", "fixture run was cancelled");
    const steps = 1;
    if (steps > input.maxSteps) {
      throw new UfoExperimentError("step_limit_exceeded", "fixture step limit was exceeded");
    }
    await Promise.resolve();
    const nextValue = input.operation === "advance" ? input.value + 1 : input.value;
    return {
      steps,
      observedValue: input.value,
      nextValue,
      summary: input.operation === "advance"
        ? "The disposable counter fixture advanced by one step."
        : "The disposable counter fixture was observed without changing it.",
    };
  }
}

export class UfoExperimentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "UfoExperimentError";
  }
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function loadUfoExperimentConfig(env: NodeJS.ProcessEnv = process.env): UfoExperimentConfig {
  const rawMode = env.UFO_EXPERIMENT_MODE?.trim().toLowerCase();
  const mode: UfoExperimentConfig["mode"] = rawMode === "fixture" ? "fixture" : rawMode === "ufo" ? "ufo" : "off";
  const rawIsolation = env.UFO_EXPERIMENT_ISOLATION?.trim().toLowerCase();
  const isolation: UfoExperimentConfig["isolation"] = rawIsolation === "synthetic-fixture-v1"
    ? "synthetic-fixture-v1"
    : rawIsolation === "disposable-windows-vm" ? "disposable-windows-vm" : "none";
  const requested = (env.UFO_EXPERIMENT_ALLOWED_FIXTURES ?? "counter-v1")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is UfoFixtureId => (UFO_FIXTURES as readonly string[]).includes(value));
  return {
    enabled: truthy(env.UFO_EXPERIMENT_ENABLED),
    mode,
    isolation,
    allowFixtureActions: truthy(env.UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS),
    allowedFixtures: [...new Set(requested)],
    timeoutMs: boundedInteger(env.UFO_EXPERIMENT_TIMEOUT_MS, 2_000, 100, 10_000),
    maxSteps: boundedInteger(env.UFO_EXPERIMENT_MAX_STEPS, 3, 1, 5),
  };
}

export function getUfoExperimentHealth(config: UfoExperimentConfig): UfoExperimentHealth {
  const fixtureReady = config.enabled && config.mode === "fixture" &&
    config.isolation === "synthetic-fixture-v1" && config.allowedFixtures.length > 0;
  const reason = !config.enabled
    ? "The experimental integration is disabled by default."
    : config.mode === "ufo"
      ? "No frozen Microsoft UFO artifact, SBOM, disposable Windows VM manifest, or runtime adapter is installed."
      : config.mode !== "fixture"
        ? "No experimental adapter mode was selected."
        : config.isolation !== "synthetic-fixture-v1"
          ? "The synthetic fixture isolation declaration is missing or invalid."
          : config.allowedFixtures.length === 0
            ? "The strict fixture allowlist is empty."
            : "The synthetic disposable fixture is available; this is not a Microsoft UFO runtime.";
  return {
    schemaVersion: UFO_EXPERIMENT_SCHEMA_VERSION,
    experimental: true,
    enabled: config.enabled,
    available: fixtureReady,
    mode: config.mode,
    isolation: config.isolation,
    observeOnly: !fixtureReady || !config.allowFixtureActions,
    actionsAvailable: fixtureReady && config.allowFixtureActions,
    approvalRequiredForActions: true,
    allowedFixtures: config.allowedFixtures,
    limits: { timeoutMs: config.timeoutMs, maxSteps: config.maxSteps },
    runtime: {
      adapter: config.mode === "fixture" ? "synthetic_fixture" : config.mode === "ufo" ? "microsoft_ufo" : "none",
      dependency: config.mode === "ufo" ? "unavailable" : fixtureReady ? "available" : "not_checked",
      reason,
    },
    nonGoals: [
      "No host desktop, shell, filesystem, browser, clipboard, account, network, or secret access.",
      "No claim that Microsoft UFO itself is installed, integrated, or operational.",
      "No action outside the disposable counter fixture.",
    ],
  };
}

function safeJson(value: unknown): string { return JSON.stringify(sanitiseExplorerValue(value)); }
function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try { return sanitiseExplorerValue(JSON.parse(value)); }
  catch { return sanitiseExplorerText(value); }
}
function fromRow(row: RequestRow): UfoExperimentRecord {
  return {
    id: row.id, requestKey: row.request_key, observabilityRunId: row.observability_run_id,
    fixtureId: row.fixture_id as UfoFixtureId, operation: row.operation as UfoExperimentOperation,
    status: row.status as UfoExperimentStatus, version: Number(row.version), steps: Number(row.steps),
    maxSteps: Number(row.max_steps), inputSummary: parseJson(row.input_summary), outputSummary: parseJson(row.output_summary),
    errorCode: row.error_code, errorMessage: sanitiseExplorerText(row.error_message), createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at), completedAt: row.completed_at === null ? null : Number(row.completed_at),
  };
}
function requestFingerprint(input: UfoExperimentRequest): string {
  return createHash("sha256").update(JSON.stringify({ fixtureId: input.fixtureId, operation: input.operation,
    expectedFixtureVersion: input.expectedFixtureVersion ?? null, maxSteps: input.maxSteps ?? null })).digest("hex");
}
function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 18)}`;
}
function asError(error: unknown): UfoExperimentError {
  return error instanceof UfoExperimentError
    ? error : new UfoExperimentError("adapter_failed", error instanceof Error ? error.message : String(error));
}

export class UfoExperimentService {
  constructor(
    private readonly db: Db,
    readonly config: UfoExperimentConfig,
    private readonly observability?: ObservabilityService,
    private readonly adapter: UfoExperimentAdapter = new SyntheticFixtureAdapter(),
    private readonly now: () => number = Date.now,
  ) { this.recoverInterruptedRequests(); }

  health(): UfoExperimentHealth { return getUfoExperimentHealth(this.config); }
  get(id: string): UfoExperimentRecord | null {
    const row = this.db.prepare("SELECT * FROM ufo_experiment_requests WHERE id = ?").get(id) as RequestRow | undefined;
    return row ? fromRow(row) : null;
  }
  getByRequestKey(requestKey: string): UfoExperimentRecord | null {
    const row = this.db.prepare("SELECT * FROM ufo_experiment_requests WHERE request_key = ?").get(requestKey) as RequestRow | undefined;
    return row ? fromRow(row) : null;
  }
  fixtureState(fixtureId: UfoFixtureId) {
    const row = this.ensureFixture(fixtureId);
    return { fixtureId, value: row.value, version: row.version, updatedAt: row.updated_at };
  }

  async run(input: UfoExperimentRequest, context: UfoExperimentContext = {}): Promise<UfoExperimentRecord> {
    this.validateRequest(input);
    const fingerprint = requestFingerprint(input);
    const existing = this.getByRequestKey(input.requestKey);
    if (existing) {
      const stored = this.db.prepare("SELECT input_fingerprint FROM ufo_experiment_requests WHERE id = ?")
        .get(existing.id) as { input_fingerprint: string };
      if (stored.input_fingerprint !== fingerprint) {
        throw new UfoExperimentError("request_key_conflict", "request key was already used for different fixture input");
      }
      return existing;
    }

    const now = this.now();
    const id = stableId("ufo_req", input.requestKey);
    const runId = stableId("run_ufo", input.requestKey);
    const maxSteps = input.maxSteps ?? this.config.maxSteps;
    const inputSummary = { fixtureId: input.fixtureId, operation: input.operation,
      expectedFixtureVersion: input.expectedFixtureVersion ?? null, maxSteps };
    try {
      this.db.prepare(`INSERT INTO ufo_experiment_requests (
        id, request_key, observability_run_id, input_fingerprint, fixture_id, operation,
        status, version, steps, max_steps, input_summary, output_summary, error_code,
        error_message, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', 1, 0, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`)
        .run(id, input.requestKey, runId, fingerprint, input.fixtureId, input.operation,
          maxSteps, safeJson(inputSummary), now, now);
    } catch (error) {
      const replay = this.getByRequestKey(input.requestKey);
      if (replay) return replay;
      throw error;
    }

    this.startObservability(runId, input, context, now);
    const health = this.health();
    if (!health.available) return this.fail(id, 1, "runtime_unavailable", health.runtime.reason, "failed");
    if (input.operation === "advance" && !health.actionsAvailable) {
      return this.fail(id, 1, "observe_only", "fixture actions are disabled; observe-only is the default", "failed");
    }

    const fixture = this.ensureFixture(input.fixtureId);
    if (input.operation === "advance" && input.expectedFixtureVersion !== fixture.version) {
      return this.fail(id, 1, "stale_fixture_version", "fixture version changed before the approved action", "failed");
    }
    this.observability?.record(runId, {
      producerId: "ava:ufo-experiment", producerEventId: `${input.requestKey}:adapter-started`,
      type: "experimental.adapter.started", status: "running", title: "Synthetic UFO adapter started",
      summary: "AVA entered the disposable fixture adapter; no host resource is available to it.",
      // The parent AVA tool call owns/counts the action. This child provides
      // execution evidence only, preventing nested action double-counting.
      payload: inputSummary, actionId: `${runId}:fixture-operation`, actionOwner: "observer",
      dedupKey: `${input.requestKey}:adapter-started`,
    });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    context.signal?.addEventListener("abort", onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort();
          reject(new UfoExperimentError("timed_out", "fixture run exceeded its bounded timeout")); }, this.config.timeoutMs);
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        if (context.signal?.aborted) { controller.abort(); reject(new UfoExperimentError("cancelled", "fixture run was cancelled")); }
        else context.signal?.addEventListener("abort", () => reject(new UfoExperimentError("cancelled", "fixture run was cancelled")), { once: true });
      });
      const result = await Promise.race([this.adapter.execute({ fixtureId: input.fixtureId,
        operation: input.operation, value: fixture.value, maxSteps, signal: controller.signal }), timeout, cancelled]);
      if (result.steps > maxSteps) throw new UfoExperimentError("step_limit_exceeded", "adapter exceeded the approved step limit");
      return this.complete(id, 1, input, fixture, result);
    } catch (error) {
      const failure = asError(error);
      const status: UfoExperimentStatus = failure.code === "cancelled" ? "cancelled"
        : failure.code === "timed_out" ? "timed_out" : "failed";
      return this.fail(id, 1, failure.code, failure.message, status);
    } finally {
      if (timer) clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
    }
  }

  cancel(id: string, expectedVersion: number): UfoExperimentRecord | null {
    const now = this.now();
    const changed = this.db.prepare(`UPDATE ufo_experiment_requests
      SET status = 'cancelled', version = version + 1, error_code = 'cancelled',
          error_message = 'fixture run was cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND version = ? AND status = 'running'`).run(now, now, id, expectedVersion).changes;
    const current = this.get(id);
    if (changed && current) this.recordTerminal(current, "Fixture run cancelled", "cancelled", "cancelled");
    return current;
  }

  private validateRequest(input: UfoExperimentRequest): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(input.requestKey))
      throw new UfoExperimentError("invalid_request_key", "request key must be a bounded stable identifier");
    if (!this.config.allowedFixtures.includes(input.fixtureId))
      throw new UfoExperimentError("fixture_denied", "fixture is outside the strict allowlist");
    if (input.operation !== "observe" && input.operation !== "advance")
      throw new UfoExperimentError("operation_denied", "operation is not allowed by the fixture adapter");
    const maxSteps = input.maxSteps ?? this.config.maxSteps;
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > this.config.maxSteps)
      throw new UfoExperimentError("step_limit_exceeded", "requested step limit exceeds the configured bound");
    if (input.operation === "advance" && (!Number.isInteger(input.expectedFixtureVersion) || Number(input.expectedFixtureVersion) < 1))
      throw new UfoExperimentError("expected_version_required", "an approved fixture action requires the observed fixture version");
  }

  private ensureFixture(fixtureId: UfoFixtureId): FixtureRow {
    const now = this.now();
    this.db.prepare(`INSERT OR IGNORE INTO ufo_fixture_state (fixture_id, value, version, updated_at)
      VALUES (?, 0, 1, ?)`).run(fixtureId, now);
    return this.db.prepare("SELECT * FROM ufo_fixture_state WHERE fixture_id = ?").get(fixtureId) as FixtureRow;
  }

  private startObservability(runId: string, input: UfoExperimentRequest, context: UfoExperimentContext, startedAt: number): void {
    if (!this.observability || this.observability.getRun(runId)) return;
    const parent = context.parentRunId ? this.observability.getRun(context.parentRunId) : null;
    this.observability.startRun({ id: runId,
      ...(parent ? { traceId: parent.traceId, parentRunId: parent.id, rootTaskId: parent.rootTaskId ?? parent.id } : {}),
      sessionId: context.sessionId ?? parent?.sessionId ?? null, runKind: "experimental_computer_use_fixture",
      runtimeId: "ava:ufo-experiment", runtimeType: "external_adapter", hostRuntimeId: "ava",
      ownerType: "ava", ownerId: "ufo-experiment-adapter", ownerRole: "integration",
      title: input.operation === "observe" ? "Observe disposable UFO fixture" : "Run approved disposable UFO fixture action",
      objective: `${input.operation} ${input.fixtureId}`, privacyLevel: "personal",
      staleAfterMs: this.config.timeoutMs + 1_000, startedAt });
    this.observability.record(runId, { producerId: "ava:ufo-experiment",
      producerEventId: `${input.requestKey}:boundary`, type: "experimental.boundary.checked", status: "observed",
      title: "Experimental isolation boundary checked",
      summary: "Only the synthetic disposable fixture adapter is in scope; Microsoft UFO and host control remain unavailable.",
      payload: { mode: this.config.mode, isolation: this.config.isolation,
        observeOnly: this.health().observeOnly, usage: "not_reported", cost: "not_reported" },
      dedupKey: `${input.requestKey}:boundary` });
  }

  private complete(id: string, expectedRequestVersion: number, input: UfoExperimentRequest,
    fixture: FixtureRow, result: UfoAdapterResult): UfoExperimentRecord {
    const now = this.now();
    const output = this.db.transaction(() => {
      const request = this.db.prepare("SELECT * FROM ufo_experiment_requests WHERE id = ?").get(id) as RequestRow;
      if (request.status !== "running" || request.version !== expectedRequestVersion) return fromRow(request);
      let fixtureVersion = fixture.version;
      if (input.operation === "advance") {
        const changed = this.db.prepare(`UPDATE ufo_fixture_state SET value = ?, version = version + 1, updated_at = ?
          WHERE fixture_id = ? AND version = ?`).run(result.nextValue, now, input.fixtureId, fixture.version).changes;
        if (!changed) throw new UfoExperimentError("stale_fixture_version", "fixture changed before completion; action was not replayed");
        fixtureVersion += 1;
      }
      const summary = { adapter: this.adapter.id, observedValue: result.observedValue, value: result.nextValue,
        fixtureVersion, steps: result.steps, summary: result.summary, hostResourcesTouched: [] };
      this.db.prepare(`UPDATE ufo_experiment_requests SET status = 'completed', version = version + 1,
        steps = ?, output_summary = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND version = ? AND status = 'running'`)
        .run(result.steps, safeJson(summary), now, now, id, expectedRequestVersion);
      return this.get(id)!;
    })();
    if (output.status === "completed") this.recordTerminal(output, "Disposable fixture completed", "success", "fixture_outcome_verified");
    return output;
  }

  private fail(id: string, expectedVersion: number, code: string, message: string, status: UfoExperimentStatus): UfoExperimentRecord {
    const now = this.now();
    const safeMessage = sanitiseExplorerText(message) ?? "experimental adapter failed";
    this.db.prepare(`UPDATE ufo_experiment_requests SET status = ?, version = version + 1,
      error_code = ?, error_message = ?, output_summary = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND version = ? AND status = 'running'`)
      .run(status, code, safeMessage, safeJson({ code, message: safeMessage }), now, now, id, expectedVersion);
    const record = this.get(id)!;
    if (record.status !== "running") this.recordTerminal(record, safeMessage,
      status === "cancelled" ? "cancelled" : "error", code);
    return record;
  }

  private recordTerminal(record: UfoExperimentRecord, summary: string, status: string, outcome: string): void {
    if (!this.observability?.getRun(record.observabilityRunId)) return;
    const runStatus = record.status === "completed" ? "completed"
      : record.status === "cancelled" ? "cancelled" : record.status === "timed_out" ? "timed_out" : "failed";
    this.observability.record(record.observabilityRunId, { producerId: "ava:ufo-experiment",
      producerEventId: `${record.requestKey}:terminal:${record.status}`,
      type: record.status === "completed" ? "experimental.adapter.completed" : "experimental.adapter.failed",
      status, title: record.status === "completed" ? "Disposable fixture completed" : "Experimental adapter stopped safely",
      summary, visibility: "sensitive_collapsed",
      payload: { requestId: record.id, fixtureId: record.fixtureId, operation: record.operation,
        steps: record.steps, evidence: record.outputSummary, runtime: "synthetic_fixture",
        microsoftUfoRuntime: "unavailable", usage: "not_reported", cost: "not_reported" },
      error: record.status === "completed" ? null : record.errorMessage,
      actionId: `${record.observabilityRunId}:fixture-operation`, actionOwner: "observer", terminal: true,
      runStatus, outcome, verificationStatus: record.status === "completed" ? "verified" : "not_verified",
      compactSummary: summary, dedupKey: `${record.requestKey}:terminal:${record.status}` });
  }

  private recoverInterruptedRequests(): number {
    const rows = this.db.prepare("SELECT * FROM ufo_experiment_requests WHERE status = 'running'").all() as RequestRow[];
    for (const row of rows) this.fail(row.id, row.version, "runtime_restarted",
      "AVA restarted before the disposable fixture result was committed; no action was replayed", "failed");
    return rows.length;
  }
}
