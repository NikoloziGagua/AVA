import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService } from "../observability/store.js";
import {
  SyntheticFixtureAdapter,
  UfoExperimentError,
  UfoExperimentService,
  getUfoExperimentHealth,
  loadUfoExperimentConfig,
  type UfoAdapterResult,
  type UfoExperimentAdapter,
  type UfoExperimentConfig,
} from "./experiment.js";

function config(overrides: Partial<UfoExperimentConfig> = {}): UfoExperimentConfig {
  return {
    enabled: true,
    mode: "fixture",
    isolation: "synthetic-fixture-v1",
    allowFixtureActions: false,
    allowedFixtures: ["counter-v1"],
    timeoutMs: 500,
    maxSteps: 3,
    ...overrides,
  };
}

function deferredAdapter() {
  let resolve!: (value: UfoAdapterResult) => void;
  const promise = new Promise<UfoAdapterResult>((done) => { resolve = done; });
  const adapter: UfoExperimentAdapter = { id: "synthetic_fixture", execute: async () => promise };
  return { adapter, resolve };
}

describe("UFO experiment configuration and health", () => {
  it("is disabled and unavailable by default", () => {
    const parsed = loadUfoExperimentConfig({});
    expect(parsed).toMatchObject({ enabled: false, mode: "off", isolation: "none", allowFixtureActions: false });
    expect(getUfoExperimentHealth(parsed)).toMatchObject({ available: false, observeOnly: true,
      runtime: { adapter: "none", dependency: "not_checked" } });
  });

  it("fails closed for a requested real UFO runtime without frozen dependencies and isolation", () => {
    const health = getUfoExperimentHealth(config({ mode: "ufo", isolation: "disposable-windows-vm" }));
    expect(health).toMatchObject({ available: false, runtime: { adapter: "microsoft_ufo", dependency: "unavailable" } });
    expect(health.runtime.reason).toMatch(/frozen Microsoft UFO artifact/i);
  });
});

describe("UFO experiment service", () => {
  it("records a fail-closed default-off receipt and Mission Control outcome", async () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const service = new UfoExperimentService(db, config({ enabled: false }), observability);
    const result = await service.run({ requestKey: "disabled.observe.1", fixtureId: "counter-v1", operation: "observe" });
    expect(result).toMatchObject({ status: "failed", errorCode: "runtime_unavailable" });
    const run = observability.getRun(result.observabilityRunId);
    expect(run).toMatchObject({ status: "failed", outcome: "runtime_unavailable", verificationStatus: "not_verified" });
    expect(observability.getEvents(run!.id).map((event) => event.type)).toContain("experimental.adapter.failed");
    db.close();
  });

  it("observes the disposable fixture and correlates a single child trace", async () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const parent = observability.startRun({ id: "parent-ufo", traceId: "trace-ufo", runKind: "chat_agent",
      runtimeType: "ava", ownerType: "ava", title: "Parent" });
    const service = new UfoExperimentService(db, config(), observability, new SyntheticFixtureAdapter());
    const result = await service.run({ requestKey: "observe.fixture.1", fixtureId: "counter-v1", operation: "observe" },
      { parentRunId: parent.id });
    expect(result.status).toBe("completed");
    expect(result.outputSummary).toMatchObject({ value: 0, fixtureVersion: 1, hostResourcesTouched: [] });
    const run = observability.getRun(result.observabilityRunId)!;
    expect(run).toMatchObject({ traceId: "trace-ufo", parentRunId: parent.id, status: "completed",
      verificationStatus: "verified" });
    expect(run.directCostMicrousd).toBe(0);
    const terminal = observability.getEvents(run.id).filter((event) => event.terminal);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ actionOwner: "observer", actionCounted: false });
    db.close();
  });

  it("keeps actions observe-only until explicitly configured", async () => {
    const db = openInMemoryDb();
    const service = new UfoExperimentService(db, config());
    const result = await service.run({ requestKey: "action.denied.1", fixtureId: "counter-v1",
      operation: "advance", expectedFixtureVersion: 1 });
    expect(result).toMatchObject({ status: "failed", errorCode: "observe_only" });
    expect(service.fixtureState("counter-v1")).toMatchObject({ value: 0, version: 1 });
    db.close();
  });

  it("commits one version-guarded fixture action and deduplicates replay", async () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const service = new UfoExperimentService(db, config({ allowFixtureActions: true }), observability);
    const input = { requestKey: "action.once.1", fixtureId: "counter-v1" as const,
      operation: "advance" as const, expectedFixtureVersion: 1 };
    const first = await service.run(input);
    const replay = await service.run(input);
    expect(first).toEqual(replay);
    expect(service.fixtureState("counter-v1")).toMatchObject({ value: 1, version: 2 });
    expect(observability.listRuns().filter((run) => run.runKind === "experimental_computer_use_fixture")).toHaveLength(1);
    expect(observability.getEvents(first.observabilityRunId).filter((event) => event.terminal)).toHaveLength(1);
    await expect(service.run({ ...input, operation: "observe" })).rejects.toMatchObject({ code: "request_key_conflict" });
    db.close();
  });

  it("denies non-allowlisted fixtures and excessive step limits before execution", async () => {
    const db = openInMemoryDb();
    const service = new UfoExperimentService(db, config());
    await expect(service.run({ requestKey: "fixture.denied.1", fixtureId: "other" as "counter-v1", operation: "observe" }))
      .rejects.toMatchObject({ code: "fixture_denied" });
    await expect(service.run({ requestKey: "steps.denied.1", fixtureId: "counter-v1", operation: "observe", maxSteps: 4 }))
      .rejects.toMatchObject({ code: "step_limit_exceeded" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM ufo_experiment_requests").get()).toEqual({ count: 0 });
    db.close();
  });

  it("times out a stuck adapter without mutating the fixture", async () => {
    const db = openInMemoryDb();
    const pending = deferredAdapter();
    const service = new UfoExperimentService(db, config({ allowFixtureActions: true, timeoutMs: 20 }), undefined, pending.adapter);
    const result = await service.run({ requestKey: "timeout.action.1", fixtureId: "counter-v1",
      operation: "advance", expectedFixtureVersion: 1 });
    expect(result).toMatchObject({ status: "timed_out", errorCode: "timed_out" });
    pending.resolve({ steps: 1, observedValue: 0, nextValue: 1, summary: "late" });
    await Promise.resolve();
    expect(service.fixtureState("counter-v1")).toMatchObject({ value: 0, version: 1 });
    db.close();
  });

  it("cancels cooperatively and suppresses a late completion", async () => {
    const db = openInMemoryDb();
    const pending = deferredAdapter();
    const service = new UfoExperimentService(db, config({ allowFixtureActions: true }), undefined, pending.adapter);
    const controller = new AbortController();
    const run = service.run({ requestKey: "cancel.action.1", fixtureId: "counter-v1",
      operation: "advance", expectedFixtureVersion: 1 }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    const result = await run;
    pending.resolve({ steps: 1, observedValue: 0, nextValue: 1, summary: "late" });
    await Promise.resolve();
    expect(result.status).toBe("cancelled");
    expect(service.fixtureState("counter-v1")).toMatchObject({ value: 0, version: 1 });
    db.close();
  });

  it("rejects stale cancellation versions and keeps terminal projection immutable", async () => {
    const db = openInMemoryDb();
    const pending = deferredAdapter();
    const service = new UfoExperimentService(db, config({ allowFixtureActions: true }), undefined, pending.adapter);
    const run = service.run({ requestKey: "cancel.version.1", fixtureId: "counter-v1",
      operation: "advance", expectedFixtureVersion: 1 });
    await Promise.resolve();
    const active = service.getByRequestKey("cancel.version.1")!;
    expect(service.cancel(active.id, active.version + 1)?.status).toBe("running");
    expect(service.cancel(active.id, active.version)?.status).toBe("cancelled");
    pending.resolve({ steps: 1, observedValue: 0, nextValue: 1, summary: "late" });
    const completed = await run;
    expect(completed.status).toBe("cancelled");
    expect(service.cancel(active.id, completed.version)?.status).toBe("cancelled");
    expect(service.fixtureState("counter-v1")).toMatchObject({ value: 0, version: 1 });
    db.close();
  });

  it("recovers an interrupted request on restart and never replays its action", async () => {
    const db = openInMemoryDb();
    const pending = deferredAdapter();
    const first = new UfoExperimentService(db, config({ allowFixtureActions: true }), undefined, pending.adapter);
    const run = first.run({ requestKey: "restart.action.1", fixtureId: "counter-v1",
      operation: "advance", expectedFixtureVersion: 1 });
    await Promise.resolve();
    const restarted = new UfoExperimentService(db, config({ allowFixtureActions: true }));
    pending.resolve({ steps: 1, observedValue: 0, nextValue: 1, summary: "late" });
    const result = await run;
    expect(result).toMatchObject({ status: "failed", errorCode: "runtime_restarted" });
    expect(restarted.fixtureState("counter-v1")).toMatchObject({ value: 0, version: 1 });
    db.close();
  });

  it("redacts adapter failures before durable request and Mission Control storage", async () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const adapter: UfoExperimentAdapter = { id: "synthetic_fixture", execute: async () => {
      throw new Error("Authorization: Bearer owner-secret\npassword is hunter2");
    } };
    const service = new UfoExperimentService(db, config(), observability, adapter);
    const result = await service.run({ requestKey: "redact.observe.1", fixtureId: "counter-v1", operation: "observe" });
    const durable = JSON.stringify({ result, events: observability.getEvents(result.observabilityRunId),
      row: db.prepare("SELECT * FROM ufo_experiment_requests WHERE id = ?").get(result.id) });
    expect(durable).not.toContain("owner-secret");
    expect(durable).not.toContain("hunter2");
    expect(durable).toContain("***");
    db.close();
  });
});
