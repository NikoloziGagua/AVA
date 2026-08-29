import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryIndexService } from "../memory-index/store.js";
import { ObservabilityService } from "../observability/store.js";
import { openInMemoryDb } from "../state/db.js";
import { DeterministicAutomationFixtureExecutor } from "./activepieces.js";
import { AutomationPlaybookService, buildAutomationWorkflowRegistrations } from "./playbooks.js";
import { APPROVED_ACTION_PLAN_WORKFLOW, OPERATIONS_BRIEF_WORKFLOW, SYSTEM_REPORT_WORKFLOW,
  renderApprovedStepManifest, type AutomationApprovedActionSnapshot } from "./types.js";

const systemSnapshot = async () => ({ generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", ready: true, provider: "openai", core: { brainReady: true,
  voiceReady: true, browserReady: true, memoryReady: true }, counts: { preferences: 1, observations: 2,
  projects: 3, people: 4, playbooks: 5, watches: 6 }, integrations: { instagram: true, whatsapp: true,
  shopify: false, googlePlaces: false, screenVision: true, push: false, microsoftUfoAvailable: true } });
const operationsSnapshot = async () => ({ generatedAt: 2, generatedAtIso: "1970-01-01T00:00:00.002Z", windowHours: 24 as const,
  readiness: { ready: true, provider: "openai", brainReady: true, voiceReady: true,
    browserReady: true, memoryReady: true }, recentRuns: { total: 10, active: 1, completed: 7,
    failed: 1, cancelled: 1, timedOut: 0, verified: 6, notVerified: 3 }, attention: {
    pendingApprovals: 1, blockedSelfImprovements: 2, blockedWatcherSuccessors: 3 }, work: {
    pinnedNotes: 4, notesDoing: 5, notesInReview: 6, activeSelfImprovements: 1,
    shippedSelfImprovements: 8, enabledWatches: 2 }, knowledge: { activeMemoryEntries: 100,
    verifiedMemorySources: 90 } });

function registrations() {
  return buildAutomationWorkflowRegistrations({ systemReportSnapshot: systemSnapshot, operationsBriefSnapshot: operationsSnapshot });
}

function approvedPlanSnapshot(): AutomationApprovedActionSnapshot {
  const steps: AutomationApprovedActionSnapshot["sequence"]["steps"] = [
    { id: "step-1", tool: "chrome_google_search", targetLabel: "Google search",
      targetFingerprint: "a".repeat(64) },
    { id: "step-2", tool: "instagram_open_chat", targetLabel: "Open a verified Instagram conversation",
      targetFingerprint: "b".repeat(64) },
  ];
  return { schemaVersion: 2, generatedAt: 2, generatedAtIso: "1970-01-01T00:00:00.002Z",
    playbookId: "ava.learned.sequence.test-plan", revision: 1, displayName: "Read-only proof",
    sequence: { kind: "tool_sequence", stepCount: steps.length, steps,
      renderedSteps: renderApprovedStepManifest(steps) },
    approval: { state: "approved", evidenceTaskCount: 2,
      evidenceFingerprint: "c".repeat(64), definitionFingerprint: "d".repeat(64) } };
}

describe("AVA-owned pinned automation playbooks", () => {
  it("writes, verifies, observes, indexes, and deduplicates both registered playbooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-"));
    const db = openInMemoryDb();
    const obs = new ObservabilityService(db);
    const memory = new MemoryIndexService(db, null, null, join(root, "automation-artifacts"));
    obs.startRun({ id: "parent", traceId: "trace", runKind: "chat_agent", runtimeType: "ava", ownerType: "ava", title: "chat" });
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(), root, registrations(), obs,
      async (recordId) => (await memory.captureAutomationArtifact({ recordId })).result.entry.id);

    const health = await service.run(SYSTEM_REPORT_WORKFLOW.id, { requestKey: "health", parentRunId: "parent" });
    const brief = await service.run(OPERATIONS_BRIEF_WORKFLOW.id, { requestKey: "brief", parentRunId: "parent" });
    const replay = await service.run(OPERATIONS_BRIEF_WORKFLOW.id, { requestKey: "brief", parentRunId: "parent" });

    expect(health).toMatchObject({ status: "completed", verificationState: "verified", stepCount: 2,
      workflowId: "ava.system-report" });
    expect(brief).toMatchObject({ status: "completed", verificationState: "verified", stepCount: 2,
      workflowId: "ava.operations-brief" });
    expect(replay.id).toBe(brief.id);
    expect(service.list()).toHaveLength(2);
    expect(await readFile(health.artifactPath!, "utf8")).toContain("# AVA System Health Report");
    expect(await readFile(brief.artifactPath!, "utf8")).toContain("# AVA Operations Brief");
    expect(obs.getRun(brief.observabilityRunId)).toMatchObject({ parentRunId: "parent", status: "completed",
      title: "AVA operations brief" });
    expect(brief.memoryEntryId).toMatch(/^memory_artifact_/);
    await expect(memory.search("operations brief approvals watches"))
      .resolves.toMatchObject({ results: [{ usable: true, source: { type: "automation_artifact", status: "verified" } }] });
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("does not create or verify an artifact for executor failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor("failure"), root, registrations());
    const result = await service.run(OPERATIONS_BRIEF_WORKFLOW.id, { requestKey: "failure" });
    expect(result).toMatchObject({ status: "failed", verificationState: "unavailable", artifactPath: null });
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("rejects a request-key collision across workflows", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(), root, registrations());
    await service.run(SYSTEM_REPORT_WORKFLOW.id, { requestKey: "same" });
    await expect(service.run(OPERATIONS_BRIEF_WORKFLOW.id, { requestKey: "same" }))
      .rejects.toThrow("belongs to another workflow");
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("validates the complete ordered plan and rejects a tampered projection before dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(), root, registrations());
    const completed = await service.run(APPROVED_ACTION_PLAN_WORKFLOW.id, {
      requestKey: "valid-plan", snapshot: approvedPlanSnapshot(),
    });
    expect(completed).toMatchObject({ status: "completed", verificationState: "verified",
      inputSummary: { sequence: { stepCount: 2 } } });
    const tampered = approvedPlanSnapshot();
    tampered.sequence.renderedSteps = tampered.sequence.renderedSteps.replace("Google search", "YouTube search");
    await expect(service.run(APPROVED_ACTION_PLAN_WORKFLOW.id, {
      requestKey: "tampered-plan", snapshot: tampered,
    })).rejects.toMatchObject({ code: "invalid_generated_playbook" });
    expect(service.list()).toHaveLength(1);
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("marks interrupted work failed on restart instead of replaying it", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    db.prepare(`INSERT INTO automation_runs (id,request_key,input_fingerprint,workflow_id,workflow_version,executor,
      observability_run_id,status,version,input_summary,output_summary,created_at,updated_at)
      VALUES ('old','old','x','ava.operations-brief',1,'activepieces','obs-old','running',1,'{}','{}',1,1)`).run();
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(), root, registrations());
    expect(service.get("old")).toMatchObject({ status: "failed", errorCode: "interrupted_by_restart" });
    await rm(root, { recursive: true, force: true }); db.close();
  });
});
