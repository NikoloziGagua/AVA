import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/state/db.js";
import { createSession } from "../src/state/sessions.js";
import { decide } from "../src/state/approvals.js";
import { buildPolicyHook } from "../src/policy/runtime.js";
import { ObservabilityService } from "../src/observability/store.js";
import { UfoExperimentService, type UfoExperimentConfig } from "../src/ufo/experiment.js";
import { buildUfoExperimentTools } from "../src/tools/ufo-experiment-mcp.js";

const dir = mkdtempSync(join(tmpdir(), "ava-ufo-smoke-"));
const path = join(dir, "state.db");
const config: UfoExperimentConfig = {
  enabled: true,
  mode: "fixture",
  isolation: "synthetic-fixture-v1",
  allowFixtureActions: true,
  allowedFixtures: ["counter-v1"],
  timeoutMs: 500,
  maxSteps: 3,
};

try {
  const db = openDb(path);
  const observability = new ObservabilityService(db);
  const parent = observability.startRun({ id: "smoke-parent", runKind: "chat_agent",
    runtimeType: "ava", ownerType: "ava", title: "UFO fixture smoke" });
  const service = new UfoExperimentService(db, config, observability);
  const tools = buildUfoExperimentTools(service);
  const observe = tools.find((tool) => tool.tool.name === "ufo_experiment_observe")!;
  const action = tools.find((tool) => tool.tool.name === "ufo_experiment_action")!;
  const observed = await observe.run({ fixtureId: "counter-v1" }, { runId: parent.id });
  assert.equal(observed.ok, true);

  const session = createSession(db, { title: "UFO smoke" });
  const policy = buildPolicyHook({
    db,
    sessionId: session.id,
    approvalTimeoutMs: 2_000,
    emit: (event) => {
      if (event.kind === "approval_required") setTimeout(() => decide(db, event.payload.id, "approved"), 5);
    },
  });
  const allowed = await policy("ufo_experiment_action", { fixtureId: "counter-v1", expectedFixtureVersion: 1 });
  assert.equal(allowed.allow, true);
  const acted = await action.run({ fixtureId: "counter-v1", expectedFixtureVersion: 1 }, { runId: parent.id });
  assert.equal(acted.ok, true);
  assert.deepEqual(pickState(service.fixtureState("counter-v1")), { value: 1, version: 2 });
  const replay = await action.run({ fixtureId: "counter-v1", expectedFixtureVersion: 1 }, { runId: parent.id });
  assert.equal(replay.text, acted.text);
  assert.deepEqual(pickState(service.fixtureState("counter-v1")), { value: 1, version: 2 });
  db.close();

  const restartedDb = openDb(path);
  const restarted = new UfoExperimentService(restartedDb, config, new ObservabilityService(restartedDb));
  assert.deepEqual(pickState(restarted.fixtureState("counter-v1")), { value: 1, version: 2 });
  const rows = restartedDb.prepare("SELECT COUNT(*) AS count FROM ufo_experiment_requests").get() as { count: number };
  assert.equal(rows.count, 2);
  restartedDb.close();
  console.log(JSON.stringify({ ok: true, fixture: "counter-v1", finalValue: 1,
    finalVersion: 2, durableRequests: 2, replayWasIdempotent: true,
    hostResourcesTouched: [], microsoftUfoRuntime: "unavailable" }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function pickState(state: { value: number; version: number }) {
  return { value: state.value, version: state.version };
}
