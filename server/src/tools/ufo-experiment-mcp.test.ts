import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInMemoryDb } from "../state/db.js";
import { MICROSOFT_UFO_COMMIT, MICROSOFT_UFO_RELEASE, UfoExperimentService,
  type UfoExperimentAdapter, type UfoExperimentConfig } from "../ufo/experiment.js";
import { buildUfoExperimentTools } from "./ufo-experiment-mcp.js";
import { TaskReceiptBuilder } from "../receipts/task-receipt.js";

const config: UfoExperimentConfig = { enabled: true, mode: "fixture", isolation: "synthetic-fixture-v1",
  allowFixtureActions: true, allowedFixtures: ["counter-v1"], timeoutMs: 500, maxSteps: 3 };

describe("UFO experiment tools", () => {
  it("does not advertise a fake action tool while default-off or observe-only", () => {
    const db = openInMemoryDb();
    const tools = buildUfoExperimentTools(new UfoExperimentService(db, { ...config, enabled: false,
      mode: "off", isolation: "none", allowFixtureActions: false }));
    expect(tools.map((tool) => tool.tool.name)).toEqual(["ufo_experiment_status", "ufo_experiment_observe"]);
    db.close();
  });

  it("exposes truthful status and structured verification for fixture-only operations", async () => {
    const db = openInMemoryDb();
    const tools = buildUfoExperimentTools(new UfoExperimentService(db, config));
    expect(tools.map((tool) => tool.tool.name)).toEqual([
      "ufo_experiment_status", "ufo_experiment_observe", "ufo_experiment_action",
    ]);
    const status = await tools[0]!.run({}, { runId: "run-status" });
    expect(JSON.parse(status.text)).toMatchObject({ available: true, runtime: { adapter: "synthetic_fixture" } });
    const observed = await tools[1]!.run({ fixtureId: "counter-v1" }, { runId: "run-observe" });
    expect(observed).toMatchObject({ ok: true, verification: { state: "verified", method: "ufo_synthetic_fixture_read" } });
    expect(observed.text).toContain("hostResourcesTouched");
    const receipt = new TaskReceiptBuilder({ taskId: "task-ufo", objective: "Observe the fixture", mode: "action", startedAt: 1 });
    receipt.observe({ kind: "tool_call", payload: { tool: "ufo_experiment_observe", args: { fixtureId: "counter-v1" } } });
    receipt.observe({ kind: "tool_result", payload: { tool: "ufo_experiment_observe", ok: observed.ok,
      result: observed.text, verification: observed.verification } });
    receipt.observe({ kind: "final", payload: { text: "Observed." } });
    receipt.observe({ kind: "done", payload: {} });
    expect(receipt.snapshot(2)).toMatchObject({ lifecycle: "finished", outcome: "partial",
      verificationScope: "operational_steps", verificationMethod: "ufo_synthetic_fixture_read" });
    const acted = await tools[2]!.run({ fixtureId: "counter-v1", expectedFixtureVersion: 1 }, { runId: "run-observe" });
    expect(acted.ok).toBe(true);
    const refreshed = await tools[1]!.run({ fixtureId: "counter-v1" }, { runId: "run-observe" });
    expect(JSON.parse(refreshed.text).outputSummary).toMatchObject({ value: 1, fixtureVersion: 2 });
    db.close();
  });

  it("advertises one fixed genuine-runtime tool and produces a verified task receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-ufo-tool-"));
    try {
      const sourceDir = join(dir, "source");
      mkdirSync(sourceDir);
      const pythonPath = join(dir, "python.exe");
      const manifestPath = join(dir, "manifest.json");
      const fixtureHelperPath = join(dir, "fixture.py");
      writeFileSync(pythonPath, "python");
      writeFileSync(fixtureHelperPath, "fixture");
      writeFileSync(manifestPath, JSON.stringify({ provider: "microsoft/UFO", release: MICROSOFT_UFO_RELEASE,
        commit: MICROSOFT_UFO_COMMIT, configuration: "ava-bounded-notepad-v1", commandLineExecutorEnabled: false }));
      const realConfig: UfoExperimentConfig = { enabled: true, mode: "ufo", isolation: "local-windows-user-session",
        allowFixtureActions: true, allowedFixtures: ["notepad-text-v1"], timeoutMs: 500, maxSteps: 8,
        runtime: { rootDir: dir, sourceDir, pythonPath, manifestPath, fixtureHelperPath,
          fixturePath: join(dir, "ava-ufo-proof.txt"), expectedRelease: MICROSOFT_UFO_RELEASE,
          expectedCommit: MICROSOFT_UFO_COMMIT, credentialsConfigured: true, platform: "win32" } };
      const adapter: UfoExperimentAdapter = { id: "microsoft_ufo", execute: async () => ({ steps: 2,
        summary: "real runtime verified", evidence: { runtime: "microsoft_ufo", exactTextVisible: true } }) };
      const db = openInMemoryDb();
      const tools = buildUfoExperimentTools(new UfoExperimentService(db, realConfig, undefined, adapter));
      expect(tools.map((tool) => tool.tool.name)).toEqual(["ufo_experiment_status", "ufo_runtime_run"]);
      const result = await tools[1]!.run({}, { runId: "run-real-ufo" });
      expect(result).toMatchObject({ ok: true,
        verification: { state: "verified", method: "microsoft_ufo_windows_uia" } });
      const receipt = new TaskReceiptBuilder({ taskId: "task-real-ufo", objective: "Run fixed UFO proof",
        mode: "action", startedAt: 1 });
      receipt.observe({ kind: "tool_call", payload: { tool: "ufo_runtime_run", args: {} } });
      receipt.observe({ kind: "tool_result", payload: { tool: "ufo_runtime_run", ok: result.ok,
        result: result.text, verification: result.verification } });
      receipt.observe({ kind: "final", payload: { text: "Verified." } });
      receipt.observe({ kind: "done", payload: {} });
      expect(receipt.snapshot(2)).toMatchObject({ verificationScope: "operational_steps",
        verificationMethod: "microsoft_ufo_windows_uia" });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
