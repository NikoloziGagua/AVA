import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../state/db.js";
import { sanitiseExplorerText, sanitiseExplorerValue } from "../explorer/redaction.js";
import type { ObservabilityService } from "../observability/store.js";
import { killTree } from "../process/kill-tree.js";

export const UFO_EXPERIMENT_SCHEMA_VERSION = 1;
export const UFO_FIXTURES = ["counter-v1", "notepad-text-v1"] as const;
export type UfoFixtureId = (typeof UFO_FIXTURES)[number];
export type UfoExperimentOperation = "observe" | "advance" | "execute";
export type UfoExperimentStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out";

export const MICROSOFT_UFO_RELEASE = "v3.0.8";
export const MICROSOFT_UFO_COMMIT = "96983c73ed09e884a5f1d7ff8936c953b234b684";
export const UFO_NOTEPAD_EXPECTED_TEXT = "AVA REAL UFO PROOF 2026-08-28";

export type UfoRuntimeConfig = {
  rootDir: string;
  sourceDir: string;
  pythonPath: string;
  manifestPath: string;
  fixtureHelperPath: string;
  fixturePath: string;
  expectedRelease: string;
  expectedCommit: string;
  credentialsConfigured: boolean;
  platform: NodeJS.Platform;
};

export type UfoExperimentConfig = {
  enabled: boolean;
  mode: "off" | "fixture" | "ufo";
  isolation: "none" | "synthetic-fixture-v1" | "disposable-windows-vm" | "local-windows-user-session";
  allowFixtureActions: boolean;
  allowedFixtures: UfoFixtureId[];
  timeoutMs: number;
  maxSteps: number;
  runtime?: UfoRuntimeConfig;
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
    release: string | null;
    commit: string | null;
    credentials: "configured" | "missing" | "not_applicable";
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
  observedValue?: number;
  nextValue?: number;
  summary: string;
  evidence?: Record<string, unknown>;
};

export type UfoExperimentAdapter = {
  readonly id: "synthetic_fixture" | "microsoft_ufo";
  execute(input: {
    requestKey: string;
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

type BoundedProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
};

export type UfoRuntimeAdapterDeps = {
  runProcess?: (input: {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
  }) => Promise<BoundedProcessResult>;
  removeRuntimeLogs?: (path: string) => void;
};

function boundedAppend(current: string, chunk: Buffer | string, limit = 128_000): string {
  const combined = current + chunk.toString();
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

async function runBoundedProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}): Promise<BoundedProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
    const onAbort = () => {
      aborted = true;
      if (typeof child.pid === "number") void killTree(child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    };
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      input.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      input.signal.removeEventListener("abort", onAbort);
      resolvePromise({ code, stdout, stderr, aborted });
    });
  });
}

function minimalUfoEnvironment(): NodeJS.ProcessEnv {
  const keep = ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  env.UFO_ENV = "ava";
  env.PYTHONIOENCODING = "utf-8";
  return env;
}

function parseHelperResult(result: BoundedProcessResult, operation: string, acceptContradiction = false): Record<string, unknown> {
  if (result.aborted) throw new UfoExperimentError("cancelled", "Microsoft UFO fixture run was cancelled");
  const last = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(last) as Record<string, unknown>; }
  catch { throw new UfoExperimentError("fixture_driver_failed", `Notepad fixture ${operation} did not return valid evidence`); }
  if (result.code !== 0 || parsed.ok !== true) {
    if (acceptContradiction && parsed.exactTextVisible === false) return parsed;
    throw new UfoExperimentError("fixture_driver_failed", `Notepad fixture ${operation} failed`);
  }
  return parsed;
}

function countUfoSteps(output: string): number {
  let maximum = 0;
  for (const match of output.matchAll(/Round\s+\d+,\s+Step\s+(\d+)/gi)) maximum = Math.max(maximum, Number(match[1]));
  return maximum;
}

export class MicrosoftUfoRuntimeAdapter implements UfoExperimentAdapter {
  readonly id = "microsoft_ufo" as const;
  private readonly runProcess: NonNullable<UfoRuntimeAdapterDeps["runProcess"]>;
  private readonly removeRuntimeLogs: NonNullable<UfoRuntimeAdapterDeps["removeRuntimeLogs"]>;

  constructor(private readonly runtime: UfoRuntimeConfig, deps: UfoRuntimeAdapterDeps = {}) {
    this.runProcess = deps.runProcess ?? runBoundedProcess;
    this.removeRuntimeLogs = deps.removeRuntimeLogs ?? ((path) => rmSync(path, { recursive: true, force: true }));
  }

  async execute(input: Parameters<UfoExperimentAdapter["execute"]>[0]): Promise<UfoAdapterResult> {
    if (input.fixtureId !== "notepad-text-v1" || input.operation !== "execute") {
      throw new UfoExperimentError("operation_denied", "The real UFO adapter exposes only the fixed Notepad text fixture");
    }
    const environment = minimalUfoEnvironment();
    if (!environment.OPENAI_API_KEY) throw new UfoExperimentError("runtime_credentials_missing", "Microsoft UFO requires the configured OpenAI provider credential");
    const taskId = `ava-ufo-${createHash("sha256").update(input.requestKey).digest("hex").slice(0, 18)}`;
    const fixedRequest = `Use the already open Windows Notepad document named ${this.runtime.fixturePath.split(/[\\/]/).at(-1)}. ` +
      `Type exactly: ${UFO_NOTEPAD_EXPECTED_TEXT}. Do not save the document. Do not open or use any other application. ` +
      "Do not communicate with anyone. Finish as soon as the exact text is visible in Notepad.";
    const helperArgs = (operation: "prepare" | "verify" | "cleanup") => [this.runtime.fixtureHelperPath, operation,
      this.runtime.fixturePath, ...(operation === "verify" ? [UFO_NOTEPAD_EXPECTED_TEXT] : [])];
    const logsPath = join(this.runtime.sourceDir, "logs", taskId);
    try {
      const prepared = await this.runProcess({ command: this.runtime.pythonPath, args: helperArgs("prepare"),
        cwd: this.runtime.rootDir, env: environment, signal: input.signal });
      parseHelperResult(prepared, "prepare");
      const executed = await this.runProcess({ command: this.runtime.pythonPath,
        args: ["-m", "ufo", "--task", taskId, "--request", fixedRequest, "--log-level", "INFO"],
        cwd: this.runtime.sourceDir, env: environment, signal: input.signal });
      if (executed.aborted) throw new UfoExperimentError("cancelled", "Microsoft UFO runtime was cancelled");
      if (executed.code !== 0) throw new UfoExperimentError("runtime_exit", "Microsoft UFO exited before the fixture outcome was verified");
      const steps = countUfoSteps(executed.stdout);
      if (steps < 1) throw new UfoExperimentError("runtime_no_actions", "Microsoft UFO completed without a recorded execution step");
      if (steps > input.maxSteps) throw new UfoExperimentError("step_limit_exceeded", "Microsoft UFO exceeded the approved step limit");
      const verifiedProcess = await this.runProcess({ command: this.runtime.pythonPath, args: helperArgs("verify"),
        cwd: this.runtime.rootDir, env: environment, signal: input.signal });
      const verified = parseHelperResult(verifiedProcess, "verify", true);
      if (verified.exactTextVisible !== true) throw new UfoExperimentError("verification_failed", "The independent UI Automation check contradicted the UFO outcome");
      return {
        steps,
        summary: "Genuine Microsoft UFO completed the fixed Notepad task and an independent UI Automation check verified the visible result.",
        evidence: {
          runtime: "microsoft_ufo",
          provider: "microsoft/UFO",
          release: this.runtime.expectedRelease,
          commit: this.runtime.expectedCommit,
          taskId,
          operation: "notepad_set_exact_text",
          processExitCode: executed.code,
          exactTextVisible: true,
          verificationMethod: "windows_uia_document_text",
          expectedTextSha256: createHash("sha256").update(UFO_NOTEPAD_EXPECTED_TEXT).digest("hex"),
          windowTitle: verified.windowTitle,
          hostResourcesTouched: ["disposable Notepad fixture"],
          rawRuntimeLogsRetained: false,
        },
      };
    } finally {
      this.removeRuntimeLogs(logsPath);
      const cleanupController = new AbortController();
      try {
        await this.runProcess({ command: this.runtime.pythonPath, args: helperArgs("cleanup"),
          cwd: this.runtime.rootDir, env: environment, signal: cleanupController.signal });
      } catch {
        // The disposable fixture may already be closed; never replace the real
        // execution result with a cleanup-only error.
      }
    }
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

export function loadUfoExperimentConfig(env: NodeJS.ProcessEnv = process.env, dataDir?: string): UfoExperimentConfig {
  const rawMode = env.UFO_EXPERIMENT_MODE?.trim().toLowerCase();
  const mode: UfoExperimentConfig["mode"] = rawMode === "fixture" ? "fixture" : rawMode === "ufo" ? "ufo" : "off";
  const rawIsolation = env.UFO_EXPERIMENT_ISOLATION?.trim().toLowerCase();
  const isolation: UfoExperimentConfig["isolation"] = rawIsolation === "synthetic-fixture-v1"
    ? "synthetic-fixture-v1"
    : rawIsolation === "disposable-windows-vm" ? "disposable-windows-vm"
      : rawIsolation === "local-windows-user-session" ? "local-windows-user-session" : "none";
  const requested = (env.UFO_EXPERIMENT_ALLOWED_FIXTURES ?? (mode === "ufo" ? "notepad-text-v1" : "counter-v1"))
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is UfoFixtureId => (UFO_FIXTURES as readonly string[]).includes(value));
  const runtimeRoot = resolve(env.UFO_RUNTIME_ROOT ?? join(dataDir ?? resolve(process.cwd(), "data"), "ufo-runtime"));
  const runtime: UfoRuntimeConfig = {
    rootDir: runtimeRoot,
    sourceDir: resolve(env.UFO_RUNTIME_SOURCE_DIR ?? join(runtimeRoot, "source")),
    pythonPath: resolve(env.UFO_RUNTIME_PYTHON ?? join(runtimeRoot, "venv", "Scripts", "python.exe")),
    manifestPath: resolve(env.UFO_RUNTIME_MANIFEST ?? join(runtimeRoot, "manifest.json")),
    fixtureHelperPath: resolve(env.UFO_RUNTIME_FIXTURE_HELPER ?? join(runtimeRoot, "ufo-notepad-fixture.py")),
    fixturePath: resolve(env.UFO_RUNTIME_FIXTURE_PATH ?? join(runtimeRoot, "ava-ufo-proof.txt")),
    expectedRelease: MICROSOFT_UFO_RELEASE,
    expectedCommit: MICROSOFT_UFO_COMMIT,
    credentialsConfigured: Boolean(env.OPENAI_API_KEY?.trim()),
    platform: process.platform,
  };
  return {
    enabled: truthy(env.UFO_EXPERIMENT_ENABLED),
    mode,
    isolation,
    allowFixtureActions: truthy(env.UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS),
    allowedFixtures: [...new Set(requested)],
    timeoutMs: boundedInteger(env.UFO_EXPERIMENT_TIMEOUT_MS, mode === "ufo" ? 240_000 : 2_000, 100, 600_000),
    maxSteps: boundedInteger(env.UFO_EXPERIMENT_MAX_STEPS, mode === "ufo" ? 8 : 3, 1, 8),
    runtime,
  };
}

function inspectRuntime(config: UfoExperimentConfig): { ready: boolean; reason: string; release: string | null; commit: string | null } {
  const runtime = config.runtime;
  if (!runtime) return { ready: false, reason: "The Microsoft UFO runtime path is not configured.", release: null, commit: null };
  if (runtime.platform !== "win32") return { ready: false, reason: "Microsoft UFO² requires a Windows runtime.", release: null, commit: null };
  for (const path of [runtime.pythonPath, runtime.sourceDir, runtime.manifestPath, runtime.fixtureHelperPath]) {
    if (!existsSync(path)) return { ready: false, reason: "The pinned Microsoft UFO runtime installation is incomplete.", release: null, commit: null };
  }
  try {
    const manifest = JSON.parse(readFileSync(runtime.manifestPath, "utf8")) as Record<string, unknown>;
    const release = typeof manifest.release === "string" ? manifest.release : null;
    const commit = typeof manifest.commit === "string" ? manifest.commit : null;
    if (manifest.provider !== "microsoft/UFO" || release !== runtime.expectedRelease || commit !== runtime.expectedCommit ||
      manifest.configuration !== "ava-bounded-notepad-v1" || manifest.commandLineExecutorEnabled !== false) {
      return { ready: false, reason: "The Microsoft UFO runtime manifest does not match AVA's pinned bounded configuration.", release, commit };
    }
    if (!runtime.credentialsConfigured) return { ready: false, reason: "The pinned runtime is installed, but its OpenAI provider credential is not configured.", release, commit };
    return { ready: true, reason: "Pinned Microsoft UFO² is available for the fixed disposable Notepad fixture.", release, commit };
  } catch {
    return { ready: false, reason: "The Microsoft UFO runtime manifest is missing or malformed.", release: null, commit: null };
  }
}

export function getUfoExperimentHealth(config: UfoExperimentConfig): UfoExperimentHealth {
  const fixtureReady = config.enabled && config.mode === "fixture" &&
    config.isolation === "synthetic-fixture-v1" && config.allowedFixtures.length > 0;
  const runtime = inspectRuntime(config);
  const realReady = config.enabled && config.mode === "ufo" && config.isolation === "local-windows-user-session" &&
    config.allowedFixtures.includes("notepad-text-v1") && runtime.ready;
  const reason = !config.enabled
    ? "The experimental integration is disabled by default."
    : config.mode === "ufo"
      ? config.isolation !== "local-windows-user-session"
        ? "The genuine runtime requires the declared local Windows user-session boundary."
        : !config.allowedFixtures.includes("notepad-text-v1")
          ? "The fixed Notepad fixture is absent from the strict allowlist."
          : runtime.reason
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
    available: fixtureReady || realReady,
    mode: config.mode,
    isolation: config.isolation,
    observeOnly: !(fixtureReady || realReady) || !config.allowFixtureActions,
    actionsAvailable: (fixtureReady || realReady) && config.allowFixtureActions,
    approvalRequiredForActions: true,
    allowedFixtures: config.allowedFixtures,
    limits: { timeoutMs: config.timeoutMs, maxSteps: config.maxSteps },
    runtime: {
      adapter: config.mode === "fixture" ? "synthetic_fixture" : config.mode === "ufo" ? "microsoft_ufo" : "none",
      dependency: config.mode === "ufo" ? runtime.ready ? "available" : "unavailable" : fixtureReady ? "available" : "not_checked",
      release: config.mode === "ufo" ? runtime.release : null,
      commit: config.mode === "ufo" ? runtime.commit : null,
      credentials: config.mode === "ufo" ? config.runtime?.credentialsConfigured ? "configured" : "missing" : "not_applicable",
      reason,
    },
    nonGoals: config.mode === "ufo" ? [
      "No arbitrary Microsoft UFO prompt or general host-control surface.",
      "No communication, account, browser, clipboard, shell, or non-fixture file task.",
      "No success claim without independent UI Automation verification.",
    ] : [
      "No host desktop, shell, filesystem, browser, clipboard, account, network, or secret access.",
      "No claim that synthetic fixture success is Microsoft UFO success.",
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
  private readonly adapter: UfoExperimentAdapter;

  constructor(
    private readonly db: Db,
    readonly config: UfoExperimentConfig,
    private readonly observability?: ObservabilityService,
    adapter?: UfoExperimentAdapter,
    private readonly now: () => number = Date.now,
  ) {
    this.adapter = adapter ?? (config.mode === "ufo" && config.runtime
      ? new MicrosoftUfoRuntimeAdapter(config.runtime)
      : new SyntheticFixtureAdapter());
    this.recoverInterruptedRequests();
  }

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
    if ((input.operation === "advance" || input.operation === "execute") && !health.actionsAvailable) {
      return this.fail(id, 1, "observe_only", "runtime actions are disabled; observe-only is the default", "failed");
    }

    const fixture = this.ensureFixture(input.fixtureId);
    if (input.operation === "advance" && input.expectedFixtureVersion !== fixture.version) {
      return this.fail(id, 1, "stale_fixture_version", "fixture version changed before the approved action", "failed");
    }
    this.observability?.record(runId, {
      producerId: "ava:ufo-experiment", producerEventId: `${input.requestKey}:adapter-started`,
      type: "experimental.adapter.started", status: "running",
      title: this.adapter.id === "microsoft_ufo" ? "Microsoft UFO runtime started" : "Synthetic UFO adapter started",
      summary: this.adapter.id === "microsoft_ufo"
        ? "AVA launched the pinned UFO runtime for the fixed disposable Notepad fixture."
        : "AVA entered the disposable counter adapter; no host resource is available to it.",
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
          reject(new UfoExperimentError("timed_out", "experimental runtime exceeded its bounded timeout")); }, this.config.timeoutMs);
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        if (context.signal?.aborted) { controller.abort(); reject(new UfoExperimentError("cancelled", "experimental runtime was cancelled")); }
        else context.signal?.addEventListener("abort", () => reject(new UfoExperimentError("cancelled", "experimental runtime was cancelled")), { once: true });
      });
      const result = await Promise.race([this.adapter.execute({ requestKey: input.requestKey, fixtureId: input.fixtureId,
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
          error_message = 'experimental runtime was cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND version = ? AND status = 'running'`).run(now, now, id, expectedVersion).changes;
    const current = this.get(id);
    if (changed && current) this.recordTerminal(current, "Experimental runtime cancelled", "cancelled", "cancelled");
    return current;
  }

  private validateRequest(input: UfoExperimentRequest): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(input.requestKey))
      throw new UfoExperimentError("invalid_request_key", "request key must be a bounded stable identifier");
    if (!this.config.allowedFixtures.includes(input.fixtureId))
      throw new UfoExperimentError("fixture_denied", "fixture is outside the strict allowlist");
    const validPair = (input.fixtureId === "counter-v1" && (input.operation === "observe" || input.operation === "advance")) ||
      (input.fixtureId === "notepad-text-v1" && input.operation === "execute");
    if (!validPair) throw new UfoExperimentError("operation_denied", "operation is not allowed for the selected fixture");
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
      sessionId: context.sessionId ?? parent?.sessionId ?? null,
      runKind: this.adapter.id === "microsoft_ufo" ? "experimental_computer_use_runtime" : "experimental_computer_use_fixture",
      runtimeId: "ava:ufo-experiment", runtimeType: "external_adapter", hostRuntimeId: "ava",
      ownerType: "ava", ownerId: "ufo-experiment-adapter", ownerRole: "integration",
      title: input.operation === "observe" ? "Observe disposable UFO fixture"
        : input.operation === "execute" ? "Run Microsoft UFO Notepad fixture" : "Run approved disposable UFO fixture action",
      objective: `${input.operation} ${input.fixtureId}`, privacyLevel: "personal",
      staleAfterMs: this.config.timeoutMs + 1_000, startedAt });
    this.observability.record(runId, { producerId: "ava:ufo-experiment",
      producerEventId: `${input.requestKey}:boundary`, type: "experimental.boundary.checked", status: "observed",
      title: "Experimental isolation boundary checked",
      summary: this.adapter.id === "microsoft_ufo"
        ? "Only the pinned runtime and fixed disposable Notepad fixture are in scope."
        : "Only the synthetic disposable fixture adapter is in scope; Microsoft UFO and host control remain unavailable.",
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
        if (result.nextValue === undefined) throw new UfoExperimentError("adapter_failed", "fixture action omitted its next value");
        const changed = this.db.prepare(`UPDATE ufo_fixture_state SET value = ?, version = version + 1, updated_at = ?
          WHERE fixture_id = ? AND version = ?`).run(result.nextValue, now, input.fixtureId, fixture.version).changes;
        if (!changed) throw new UfoExperimentError("stale_fixture_version", "fixture changed before completion; action was not replayed");
        fixtureVersion += 1;
      }
      const summary = input.fixtureId === "counter-v1"
        ? { adapter: this.adapter.id, observedValue: result.observedValue, value: result.nextValue,
          fixtureVersion, steps: result.steps, summary: result.summary, hostResourcesTouched: [] }
        : { adapter: this.adapter.id, steps: result.steps, summary: result.summary, evidence: result.evidence };
      this.db.prepare(`UPDATE ufo_experiment_requests SET status = 'completed', version = version + 1,
        steps = ?, output_summary = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND version = ? AND status = 'running'`)
        .run(result.steps, safeJson(summary), now, now, id, expectedRequestVersion);
      return this.get(id)!;
    })();
    if (output.status === "completed") this.recordTerminal(output,
      input.fixtureId === "notepad-text-v1" ? "Microsoft UFO fixture completed and independently verified" : "Disposable fixture completed",
      "success", input.fixtureId === "notepad-text-v1" ? "runtime_outcome_verified" : "fixture_outcome_verified");
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
      status, title: record.status === "completed"
        ? record.fixtureId === "notepad-text-v1" ? "Microsoft UFO fixture verified" : "Disposable fixture completed"
        : "Experimental adapter stopped safely",
      summary, visibility: "sensitive_collapsed",
      payload: { requestId: record.id, fixtureId: record.fixtureId, operation: record.operation,
        steps: record.steps, evidence: record.outputSummary, runtime: this.adapter.id,
        microsoftUfoRuntime: this.adapter.id === "microsoft_ufo" ? "executed" : "unavailable",
        usage: "not_reported", cost: "not_reported" },
      error: record.status === "completed" ? null : record.errorMessage,
      actionId: `${record.observabilityRunId}:fixture-operation`, actionOwner: "observer", terminal: true,
      runStatus, outcome, verificationStatus: record.status === "completed" ? "verified" : "not_verified",
      compactSummary: summary, dedupKey: `${record.requestKey}:terminal:${record.status}` });
  }

  private recoverInterruptedRequests(): number {
    const rows = this.db.prepare("SELECT * FROM ufo_experiment_requests WHERE status = 'running'").all() as RequestRow[];
    for (const row of rows) this.fail(row.id, row.version, "runtime_restarted",
      "AVA restarted before the experimental runtime result was committed; no action was replayed", "failed");
    return rows.length;
  }
}
