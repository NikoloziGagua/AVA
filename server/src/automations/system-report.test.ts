import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService } from "../observability/store.js";
import { MemoryIndexService } from "../memory-index/store.js";
import { DeterministicAutomationFixtureExecutor } from "./activepieces.js";
import { SystemReportAutomationService } from "./system-report.js";

const snapshot = async () => ({ generatedAt: 1, ready: true, provider: "openai", core: { brainReady: true,
  voiceReady: true, browserReady: true, memoryReady: true }, counts: { preferences: 1, observations: 2,
  projects: 3, people: 4, playbooks: 5, watches: 6 }, integrations: { instagram: true, whatsapp: true,
  shopify: false, googlePlaces: false, screenVision: true, push: false, microsoftUfoAvailable: true } });

describe("AVA-owned system report automation", () => {
  it("writes, independently verifies, observes, and deduplicates one report", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-"));
    const db = openInMemoryDb();
    const obs = new ObservabilityService(db);
    const memory = new MemoryIndexService(db, null, null, join(root, "automation-artifacts"));
    obs.startRun({ id: "parent", traceId: "trace", runKind: "chat_agent", runtimeType: "ava", ownerType: "ava", title: "chat" });
    const service = new SystemReportAutomationService(db, new DeterministicAutomationFixtureExecutor(), root, snapshot, obs,
      async (recordId) => (await memory.captureAutomationArtifact({ recordId })).result.entry.id);
    const first = await service.run({ requestKey: "same", parentRunId: "parent" });
    const replay = await service.run({ requestKey: "same", parentRunId: "parent" });
    expect(first).toMatchObject({ status: "completed", verificationState: "verified", stepCount: 2 });
    expect(replay.id).toBe(first.id);
    expect(service.list()).toHaveLength(1);
    expect(await readFile(first.artifactPath!, "utf8")).toContain("# AVA System Health Report");
    expect(obs.getRun(first.observabilityRunId)).toMatchObject({ parentRunId: "parent", status: "completed" });
    expect(first.memoryEntryId).toMatch(/^memory_artifact_/);
    await expect(memory.search("system health report")).resolves.toMatchObject({ results: [{ usable: true,
      source: { type: "automation_artifact", status: "verified" } }] });
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("does not create or verify an artifact for executor failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    const service = new SystemReportAutomationService(db, new DeterministicAutomationFixtureExecutor("failure"), root, snapshot);
    const result = await service.run({ requestKey: "failure" });
    expect(result).toMatchObject({ status: "failed", verificationState: "unavailable", artifactPath: null });
    await rm(root, { recursive: true, force: true }); db.close();
  });

  it("marks interrupted work failed on restart instead of replaying it", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-")); const db = openInMemoryDb();
    db.prepare(`INSERT INTO automation_runs (id,request_key,input_fingerprint,workflow_id,workflow_version,executor,
      observability_run_id,status,version,input_summary,output_summary,created_at,updated_at)
      VALUES ('old','old','x','ava.system-report',1,'activepieces','obs-old','running',1,'{}','{}',1,1)`).run();
    const service = new SystemReportAutomationService(db, new DeterministicAutomationFixtureExecutor(), root, snapshot);
    expect(service.get("old")).toMatchObject({ status: "failed", errorCode: "interrupted_by_restart" });
    await rm(root, { recursive: true, force: true }); db.close();
  });
});
