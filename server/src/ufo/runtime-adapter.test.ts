import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObservabilityService } from "../observability/store.js";
import { openInMemoryDb } from "../state/db.js";
import {
  MICROSOFT_UFO_COMMIT,
  MICROSOFT_UFO_RELEASE,
  MicrosoftUfoRuntimeAdapter,
  UfoExperimentService,
  getUfoExperimentHealth,
  type UfoExperimentConfig,
  type UfoRuntimeConfig,
  type UfoRuntimeAdapterDeps,
} from "./experiment.js";

let temp = "";
let previousKey: string | undefined;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "ava-ufo-adapter-"));
  previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-provider-key";
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  rmSync(temp, { recursive: true, force: true });
});

function runtime(): UfoRuntimeConfig {
  const sourceDir = join(temp, "source");
  mkdirSync(sourceDir, { recursive: true });
  const paths = {
    pythonPath: join(temp, "python.exe"),
    manifestPath: join(temp, "manifest.json"),
    fixtureHelperPath: join(temp, "fixture.py"),
  };
  writeFileSync(paths.pythonPath, "python");
  writeFileSync(paths.fixtureHelperPath, "fixture");
  writeFileSync(paths.manifestPath, JSON.stringify({ provider: "microsoft/UFO", release: MICROSOFT_UFO_RELEASE,
    commit: MICROSOFT_UFO_COMMIT, configuration: "ava-bounded-notepad-v1", commandLineExecutorEnabled: false }));
  return { rootDir: temp, sourceDir, ...paths, fixturePath: join(temp, "ava-ufo-proof.txt"),
    expectedRelease: MICROSOFT_UFO_RELEASE, expectedCommit: MICROSOFT_UFO_COMMIT,
    credentialsConfigured: true, platform: "win32" };
}

function config(runtimeConfig: UfoRuntimeConfig): UfoExperimentConfig {
  return { enabled: true, mode: "ufo", isolation: "local-windows-user-session", allowFixtureActions: true,
    allowedFixtures: ["notepad-text-v1"], timeoutMs: 500, maxSteps: 8, runtime: runtimeConfig };
}

function successfulRunner(overrides: Partial<{ runtimeCode: number; verified: boolean }> = {}) {
  const calls: string[] = [];
  const runProcess: NonNullable<UfoRuntimeAdapterDeps["runProcess"]> = vi.fn(async ({ args, signal }) => {
    if (signal.aborted) return { code: null, stdout: "", stderr: "", aborted: true };
    if (args[0] === "-m") {
      calls.push("runtime");
      return { code: overrides.runtimeCode ?? 0,
        stdout: "Round 1, Step 1, Agent: HostAgent\nRound 1, Step 2, Agent: AppAgent\nStatus: FINISH",
        stderr: "Authorization: Bearer should-not-be-persisted", aborted: false };
    }
    const operation = args[1]!;
    calls.push(operation);
    if (operation === "verify") return { code: overrides.verified === false ? 1 : 0,
      stdout: JSON.stringify({ ok: overrides.verified !== false, exactTextVisible: overrides.verified !== false,
        windowTitle: "*ava-ufo-proof.txt - Notepad" }), stderr: "", aborted: false };
    return { code: 0, stdout: JSON.stringify({ ok: true, operation }), stderr: "", aborted: false };
  });
  return { runProcess, calls };
}

describe("genuine Microsoft UFO runtime adapter", () => {
  it("reports the pinned real runtime only when manifest, credential and bounded configuration agree", () => {
    const runtimeConfig = runtime();
    expect(getUfoExperimentHealth(config(runtimeConfig))).toMatchObject({ available: true, actionsAvailable: true,
      runtime: { adapter: "microsoft_ufo", dependency: "available", release: MICROSOFT_UFO_RELEASE,
        commit: MICROSOFT_UFO_COMMIT, credentials: "configured" } });
    writeFileSync(runtimeConfig.manifestPath, JSON.stringify({ provider: "microsoft/UFO", release: "wrong" }));
    expect(getUfoExperimentHealth(config(runtimeConfig))).toMatchObject({ available: false,
      runtime: { dependency: "unavailable" } });
  });

  it("executes one fixed runtime path, independently verifies it, deletes raw logs and emits one verified child trace", async () => {
    const runtimeConfig = runtime();
    const runner = successfulRunner();
    const removed: string[] = [];
    const adapter = new MicrosoftUfoRuntimeAdapter(runtimeConfig,
      { runProcess: runner.runProcess, removeRuntimeLogs: (path) => { removed.push(path); } });
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const parent = observability.startRun({ id: "parent-real-ufo", traceId: "trace-real-ufo", runKind: "chat_agent",
      runtimeType: "ava", ownerType: "ava", title: "Parent" });
    const service = new UfoExperimentService(db, config(runtimeConfig), observability, adapter);
    const input = { requestKey: "real.ufo.once.1", fixtureId: "notepad-text-v1" as const, operation: "execute" as const };
    const first = await service.run(input, { parentRunId: parent.id });
    const replay = await service.run(input, { parentRunId: parent.id });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ status: "completed", steps: 2,
      outputSummary: { adapter: "microsoft_ufo", evidence: { runtime: "microsoft_ufo", exactTextVisible: true,
        rawRuntimeLogsRetained: false } } });
    expect(runner.calls).toEqual(["prepare", "runtime", "verify", "cleanup"]);
    expect(removed).toHaveLength(1);
    const run = observability.getRun(first.observabilityRunId)!;
    expect(run).toMatchObject({ traceId: "trace-real-ufo", parentRunId: parent.id, status: "completed",
      outcome: "runtime_outcome_verified", verificationStatus: "verified" });
    const durable = JSON.stringify({ record: first, events: observability.getEvents(run.id) });
    expect(durable).not.toContain("should-not-be-persisted");
    expect(observability.getEvents(run.id).filter((event) => event.terminal)).toHaveLength(1);
    db.close();
  });

  it("normalizes runtime exit and independent-verification failures without claiming success", async () => {
    for (const scenario of [{ runner: successfulRunner({ runtimeCode: 1 }), code: "runtime_exit" },
      { runner: successfulRunner({ verified: false }), code: "verification_failed" }]) {
      const runtimeConfig = runtime();
      const adapter = new MicrosoftUfoRuntimeAdapter(runtimeConfig, { runProcess: scenario.runner.runProcess,
        removeRuntimeLogs: () => undefined });
      const db = openInMemoryDb();
      const result = await new UfoExperimentService(db, config(runtimeConfig), undefined, adapter)
        .run({ requestKey: `real.failure.${scenario.code}`, fixtureId: "notepad-text-v1", operation: "execute" });
      expect(result).toMatchObject({ status: "failed", errorCode: scenario.code });
      expect(scenario.runner.calls.at(-1)).toBe("cleanup");
      db.close();
    }
  });

  it("cancels the child boundary and suppresses late success", async () => {
    const runtimeConfig = runtime();
    let runtimeStarted!: () => void;
    const started = new Promise<void>((resolve) => { runtimeStarted = resolve; });
    const runProcess: NonNullable<UfoRuntimeAdapterDeps["runProcess"]> = vi.fn(async ({ args, signal }) => {
      if (args[1] === "prepare" || args[1] === "cleanup") return { code: 0,
        stdout: JSON.stringify({ ok: true }), stderr: "", aborted: false };
      runtimeStarted();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { code: null, stdout: "", stderr: "", aborted: true };
    });
    const db = openInMemoryDb();
    const controller = new AbortController();
    const service = new UfoExperimentService(db, config(runtimeConfig), undefined,
      new MicrosoftUfoRuntimeAdapter(runtimeConfig, { runProcess, removeRuntimeLogs: () => undefined }));
    const pending = service.run({ requestKey: "real.cancel.1", fixtureId: "notepad-text-v1", operation: "execute" },
      { signal: controller.signal });
    await started;
    controller.abort();
    expect(await pending).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
    db.close();
  });

  it("times out and aborts the genuine child boundary instead of accepting a late action", async () => {
    const runtimeConfig = runtime();
    let runtimeAborted = false;
    const runProcess: NonNullable<UfoRuntimeAdapterDeps["runProcess"]> = vi.fn(async ({ args, signal }) => {
      if (args[1] === "prepare" || args[1] === "cleanup") return { code: 0,
        stdout: JSON.stringify({ ok: true }), stderr: "", aborted: false };
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => { runtimeAborted = true; resolve(); }, { once: true }));
      return { code: null, stdout: "Round 1, Step 1", stderr: "", aborted: true };
    });
    const db = openInMemoryDb();
    const timedConfig = { ...config(runtimeConfig), timeoutMs: 20 };
    const service = new UfoExperimentService(db, timedConfig, undefined,
      new MicrosoftUfoRuntimeAdapter(runtimeConfig, { runProcess, removeRuntimeLogs: () => undefined }));
    const result = await service.run({ requestKey: "real.timeout.1", fixtureId: "notepad-text-v1", operation: "execute" });
    expect(result).toMatchObject({ status: "timed_out", errorCode: "timed_out" });
    await vi.waitFor(() => expect(runtimeAborted).toBe(true));
    db.close();
  });
});
