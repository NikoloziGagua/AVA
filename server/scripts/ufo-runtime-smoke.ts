import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ObservabilityService } from "../src/observability/store.js";
import { buildPolicyHook } from "../src/policy/runtime.js";
import { decide } from "../src/state/approvals.js";
import { openDb } from "../src/state/db.js";
import { createSession } from "../src/state/sessions.js";
import { buildUfoExperimentTools } from "../src/tools/ufo-experiment-mcp.js";
import { loadUfoExperimentConfig, UfoExperimentService } from "../src/ufo/experiment.js";

if (process.env.UFO_REAL_SMOKE !== "1") {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "Set UFO_REAL_SMOKE=1 for the genuine local runtime proof." }));
  process.exit(0);
}

const cfg = loadConfig();
const runtimeConfig = loadUfoExperimentConfig({
  ...process.env,
  UFO_EXPERIMENT_ENABLED: "true",
  UFO_EXPERIMENT_MODE: "ufo",
  UFO_EXPERIMENT_ISOLATION: "local-windows-user-session",
  UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS: "true",
  UFO_EXPERIMENT_ALLOWED_FIXTURES: "notepad-text-v1",
  UFO_EXPERIMENT_TIMEOUT_MS: "240000",
  UFO_EXPERIMENT_MAX_STEPS: "8",
}, cfg.dataDir);
assert.equal(runtimeConfig.runtime?.credentialsConfigured, true, "OpenAI provider credential is required for the real smoke");

const temp = mkdtempSync(join(tmpdir(), "ava-ufo-runtime-smoke-"));
try {
  const db = openDb(join(temp, "state.db"));
  const observability = new ObservabilityService(db);
  const parent = observability.startRun({ id: "ufo-real-smoke-parent", runKind: "chat_agent",
    runtimeType: "ava", ownerType: "ava", title: "Genuine UFO runtime smoke" });
  const service = new UfoExperimentService(db, runtimeConfig, observability);
  assert.equal(service.health().available, true, service.health().runtime.reason);
  assert.equal(service.health().runtime.dependency, "available");
  const tool = buildUfoExperimentTools(service).find((candidate) => candidate.tool.name === "ufo_runtime_run");
  assert.ok(tool, "real runtime tool was not advertised");

  const session = createSession(db, { title: "Genuine UFO runtime smoke" });
  const policy = buildPolicyHook({ db, sessionId: session.id, approvalTimeoutMs: 2_000,
    emit: (event) => { if (event.kind === "approval_required") setTimeout(() => decide(db, event.payload.id, "approved"), 5); } });
  const approval = await policy("ufo_runtime_run", {});
  assert.equal(approval.allow, true);

  const result = await tool.run({}, { runId: parent.id });
  assert.equal(result.ok, true, result.text);
  assert.equal(result.verification?.state, "verified");
  const record = JSON.parse(result.text) as { observabilityRunId: string; outputSummary: { evidence: {
    taskId: string; exactTextVisible: boolean; runtime: string;
  } } };
  assert.equal(record.outputSummary.evidence.exactTextVisible, true);
  assert.equal(record.outputSummary.evidence.runtime, "microsoft_ufo");
  const run = observability.getRun(record.observabilityRunId);
  assert.equal(run?.status, "completed");
  assert.equal(run?.verificationStatus, "verified");
  const terminals = observability.getEvents(record.observabilityRunId).filter((event) => event.terminal);
  assert.equal(terminals.length, 1);
  assert.equal((terminals[0]?.payload as { microsoftUfoRuntime?: string }).microsoftUfoRuntime, "executed");
  assert.equal(existsSync(join(runtimeConfig.runtime!.sourceDir, "logs", record.outputSummary.evidence.taskId)), false,
    "raw UFO provider logs/screenshots must be removed after evidence extraction");
  db.close();
  console.log(JSON.stringify({ ok: true, runtime: "microsoft_ufo", release: service.health().runtime.release,
    commit: service.health().runtime.commit, fixture: "notepad-text-v1", independentlyVerified: true,
    missionControlTerminalEvents: terminals.length, rawRuntimeLogsRetained: false }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
