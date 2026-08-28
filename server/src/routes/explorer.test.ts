import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActiveRuns, type ActiveRun } from "../orchestrator/active-runs.js";
import { SseBuffer } from "../sse/buffer.js";
import { openInMemoryDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { createExplorerTask, recordExplorerAgentEvent } from "../explorer/store.js";
import { capabilityIdsForTool, deriveExplorerCapabilities } from "../explorer/registry.js";
import { writePlaybook, type Playbook } from "../playbooks/store.js";
import type { CapabilitySnapshot } from "./capabilities.js";
import { explorerRoutes } from "./explorer.js";
import { getUfoExperimentHealth } from "../ufo/experiment.js";

function snapshot(browserReady: boolean): CapabilitySnapshot {
  return {
    generatedAt: 5_000,
    uptimeMs: 4_000,
    core: {
      brain: { ready: true, provider: "openai", model: "gpt-5.6" },
      voice: { ready: true, provider: "openai", model: "gpt-realtime-2.1", speaker: "marin" },
      browser: { ready: browserReady, mode: browserReady ? "attached" : "offline", helper: "scripts/start-ava-browser.cmd" },
      memory: { ready: true, preferences: 2, observations: 3, projects: 1, people: 4, playbooks: 2 },
    },
    integrations: {
      instagram: browserReady,
      whatsapp: browserReady,
      gmailCalendar: browserReady,
      shopify: false,
      googlePlaces: true,
      screenVision: true,
      push: false,
      microsoftUfo: getUfoExperimentHealth({
        enabled: false,
        mode: "off",
        isolation: "none",
        allowFixtureActions: false,
        allowedFixtures: [],
        timeoutMs: 10_000,
        maxSteps: 4,
      }),
    },
    automations: { watches: 2, schedulerReady: true, selfImprovement: true },
  };
}

function setup(
  browserReady = true,
  memoryDir = mkdtempSync(join(tmpdir(), "ava-explorer-routes-")),
) {
  const db = openInMemoryDb();
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use("/api/explorer", explorerRoutes(
    (_req, _res, next) => next(),
    {
      db,
      runs,
      startedAt: 1_000,
      memoryDir,
      capabilitySnapshot: async () => snapshot(browserReady),
    },
  ));
  return { app, db, runs, memoryDir };
}

describe("Explorer read API", () => {
  it("lists only instrumented tasks and exposes coverage honestly", async () => {
    const { app, db } = setup();
    createSession(db, { title: "Legacy only" });
    const session = createSession(db, { title: "Recorded" });
    createExplorerTask(db, {
      id: "run-1",
      sessionId: session.id,
      originalRequest: "do it",
      mode: "action",
      startedAt: 100,
    });
    recordExplorerAgentEvent(db, "run-1", {
      kind: "final",
      payload: { text: "done" },
    }, { at: 200 });

    const response = await request(app).get("/api/explorer/tasks").expect(200);
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0]).toMatchObject({
      id: "run-1",
      sessionTitle: "Recorded",
      status: "finished",
      verification: { status: "not_recorded" },
    });
    expect(response.body.coverage).toMatchObject({
      source: "instrumented_runtime",
      historicalBackfill: false,
    });

    await request(app).get("/api/explorer/tasks/run-1").expect(200);
    const missing = await request(app).get("/api/explorer/tasks/missing").expect(404);
    expect(missing.body).toMatchObject({
      error: "explorer_task_not_found",
      retryable: false,
      service: "ava-explorer",
      apiVersion: 2,
    });
    expect(missing.body.action).toContain("recorded task list");
    await request(app).get("/api/explorer/tasks?status=made_up").expect(400);
    await request(app).get("/api/explorer/tasks?offset=-1").expect(400);
    db.close();
  });

  it("paginates beyond the latest 100 records and reports the full total", async () => {
    const { app, db } = setup();
    const session = createSession(db, { title: "Long history" });
    for (let index = 0; index < 105; index += 1) {
      createExplorerTask(db, {
        id: `history-${String(index).padStart(3, "0")}`,
        sessionId: session.id,
        originalRequest: `task ${index}`,
        mode: "action",
        startedAt: index,
      });
    }

    const first = await request(app)
      .get("/api/explorer/tasks?limit=100&offset=0")
      .expect(200);
    expect(first.body.tasks).toHaveLength(100);
    expect(first.body).toMatchObject({
      total: 105,
      limit: 100,
      offset: 0,
      hasMore: true,
    });

    const second = await request(app)
      .get("/api/explorer/tasks?limit=100&offset=100")
      .expect(200);
    expect(second.body.tasks).toHaveLength(5);
    expect(second.body).toMatchObject({
      total: 105,
      offset: 100,
      hasMore: false,
    });
    const ids = [...first.body.tasks, ...second.body.tasks].map(
      (task: { id: string }) => task.id,
    );
    expect(new Set(ids).size).toBe(105);
    db.close();
  });

  it("uses the active-run registry as the authority for live work", async () => {
    const { app, db, runs } = setup();
    const session = createSession(db, { title: "Live task" });
    createExplorerTask(db, {
      id: "live-run",
      sessionId: session.id,
      originalRequest: "keep working",
      mode: "action",
      startedAt: Date.now() - 100,
    });
    runs.register({
      sessionId: session.id,
      runId: "live-run",
      abort: new AbortController(),
      buffer: new SseBuffer({ maxEvents: 10, maxBytes: 10_000 }),
    } satisfies ActiveRun);

    const response = await request(app).get("/api/explorer/live").expect(200);
    expect(response.body.source).toBe("active_run_registry");
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0]).toMatchObject({
      id: "live-run",
      sessionTitle: "Live task",
      status: "running",
      traceAvailable: true,
      source: "active_run_registry",
    });
    expect(response.body.tasks[0].elapsedMs).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("separates runtime health from configuration and dependency readiness", async () => {
    const { app, db } = setup(true);
    const response = await request(app).get("/api/explorer/capabilities").expect(200);
    const byId = Object.fromEntries(
      response.body.capabilities.map((capability: { id: string }) => [capability.id, capability]),
    ) as Record<string, any>;

    expect(byId.browser).toMatchObject({
      readiness: "ready",
      health: "healthy",
      statusConfidence: "high",
    });
    expect(byId.instagram).toMatchObject({
      readiness: "partially_ready",
      health: "unknown",
    });
    expect(byId.instagram.reason).toContain("does not verify");
    expect(byId.voice).toMatchObject({
      readiness: "partially_ready",
      health: "unknown",
    });
    expect(byId.places).toMatchObject({
      readiness: "partially_ready",
      health: "unknown",
    });
    expect(byId.shopify).toMatchObject({
      readiness: "setup_required",
      health: "unavailable",
    });
    expect(byId.push).toMatchObject({
      readiness: "setup_required",
      health: "unavailable",
    });
    expect(byId.ufo).toMatchObject({
      readiness: "unavailable",
      health: "unavailable",
      statusConfidence: "high",
    });
    expect(byId.ufo.reason).toContain("disabled");
    expect(response.body.sources).toContain("runtime_probe");

    const reachableSnapshot = snapshot(true);
    reachableSnapshot.core.browser.mode = "reachable";
    const reachableBrowser = deriveExplorerCapabilities(reachableSnapshot)
      .find((capability) => capability.id === "browser");
    expect(reachableBrowser).toMatchObject({
      readiness: "partially_ready",
      health: "unknown",
    });
    expect(reachableBrowser?.reason).toContain("accepts local CDP connections");
    db.close();
  });

  it("distinguishes every bounded UFO mode and maps its tools to one Atlas capability", () => {
    const state = snapshot(true);
    const deriveUfo = () => deriveExplorerCapabilities(state)
      .find((capability) => capability.id === "ufo")!;

    state.integrations.microsoftUfo = {
      ...state.integrations.microsoftUfo,
      enabled: true,
      available: true,
      mode: "fixture",
      isolation: "synthetic-fixture-v1",
      observeOnly: true,
      runtime: {
        ...state.integrations.microsoftUfo.runtime,
        adapter: "synthetic_fixture",
        dependency: "available",
        reason: "The synthetic disposable fixture is available; this is not a Microsoft UFO runtime.",
      },
    };
    expect(deriveUfo()).toMatchObject({ readiness: "partially_ready", health: "healthy" });
    expect(deriveUfo().reason).toContain("observe-only counter fixture");

    state.integrations.microsoftUfo.observeOnly = false;
    state.integrations.microsoftUfo.actionsAvailable = true;
    expect(deriveUfo().reason).toContain("approval-required");

    state.integrations.microsoftUfo = {
      ...state.integrations.microsoftUfo,
      available: false,
      mode: "ufo",
      isolation: "local-windows-user-session",
      observeOnly: true,
      actionsAvailable: false,
      runtime: {
        adapter: "microsoft_ufo",
        dependency: "unavailable",
        release: "v3.0.8",
        commit: null,
        credentials: "missing",
        reason: "The pinned runtime is present, but provider credentials are missing.",
      },
    };
    expect(deriveUfo()).toMatchObject({ readiness: "setup_required", health: "unavailable" });
    expect(deriveUfo().reason).toContain("credentials are missing");

    state.integrations.microsoftUfo.available = true;
    state.integrations.microsoftUfo.observeOnly = false;
    state.integrations.microsoftUfo.actionsAvailable = true;
    state.integrations.microsoftUfo.runtime = {
      ...state.integrations.microsoftUfo.runtime,
      dependency: "available",
      commit: "96983c73ed09e884a5f1d7ff8936c953b234b684",
      credentials: "configured",
      reason: "The exact pinned genuine runtime is available.",
    };
    expect(deriveUfo()).toMatchObject({ readiness: "ready", health: "healthy" });
    expect(deriveUfo().reason).toContain("fixed disposable Notepad proof");

    for (const tool of [
      "ufo_experiment_status",
      "ufo_experiment_observe",
      "ufo_experiment_action",
      "ufo_runtime_run",
    ]) {
      expect(capabilityIdsForTool(tool)).toEqual(["desktop.microsoft-ufo"]);
    }
  });

  it("reports its API version and instrumentation state", async () => {
    const { app, db } = setup();
    const response = await request(app).get("/api/explorer/meta").expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      service: "ava-explorer",
      apiVersion: 2,
      instrumentation: "enabled",
      serverStartedAt: 1_000,
    });
    expect(response.body.endpoints).toContain("workflows");
    db.close();
  });

  it("returns real learned playbooks with provenance and recall metrics", async () => {
    const { app, db, memoryDir } = setup();
    const playbook: Playbook = {
      slug: "open-browser-window",
      trigger: "Open and display a browser window",
      keywords: ["Chrome", "visible"],
      created: "2026-07-25",
      last_used: "2026-07-25",
      uses: 12,
      stakes: "routine",
      steps: ["Open AVA Chrome", "Verify that the window is visible"],
      version: 3,
      succ: 8,
      fail: 2,
      avg_secs: 11,
      lessons: ["Bring an existing window forward before launching another."],
      learning: {
        verified: 8, partially_verified: 0, unverified: 1, contradicted: 1,
        failed: 0, not_applicable: 0, last_task_id: "task-browser",
        last_method: "window_probe", last_evidence_at: 123, recent_task_ids: ["task-browser"],
      },
    };
    writePlaybook(memoryDir, playbook);

    const response = await request(app).get("/api/explorer/workflows").expect(200);
    expect(response.body).toMatchObject({
      apiVersion: 2,
      summary: {
        total: 1,
        withObservedOutcomes: 1,
        totalRecalls: 12,
        verifiedRuns: 8,
        unverifiedRuns: 1,
        contradictedRuns: 1,
      },
      source: {
        type: "local_playbook_store",
        parsedRecords: 1,
        excludedUnparseableRecords: 0,
      },
    });
    expect(response.body.workflows[0]).toMatchObject({
      id: "playbook:open-browser-window",
      trigger: playbook.trigger,
      revision: 3,
      evidenceState: "verified_outcomes",
      metrics: {
        recalls: 12,
        evidenceOutcomes: 10,
        verificationRate: 0.8,
        averageVerifiedDurationMs: 11_000,
      },
      capabilityMapping: { status: "not_recorded", capabilityIds: [] },
      taskLinkage: { status: "not_recorded", taskIds: [] },
    });
    expect(response.body.workflows[0].steps.map((step: { label: string }) => step.label))
      .toEqual(playbook.steps);
    db.close();
  });
});
