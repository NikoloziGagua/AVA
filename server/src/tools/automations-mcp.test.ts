import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeterministicAutomationFixtureExecutor } from "../automations/activepieces.js";
import { AutomationPlaybookService, buildAutomationWorkflowRegistrations } from "../automations/playbooks.js";
import { openInMemoryDb } from "../state/db.js";
import { buildAutomationTools } from "./automations-mcp.js";

const system = async () => ({ generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", ready: true, provider: "openai", core: { brainReady: true,
  voiceReady: true, browserReady: true, memoryReady: true }, counts: { preferences: 0, observations: 0,
  projects: 0, people: 0, playbooks: 0, watches: 0 }, integrations: { instagram: false, whatsapp: false,
  shopify: false, googlePlaces: false, screenVision: false, push: false, microsoftUfoAvailable: false } });
const operations = async () => ({ generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", windowHours: 24 as const,
  readiness: { ready: true, provider: "openai", brainReady: true, voiceReady: true, browserReady: true, memoryReady: true },
  recentRuns: { total: 0, active: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, verified: 0, notVerified: 0 },
  attention: { pendingApprovals: 0, blockedSelfImprovements: 0, blockedWatcherSuccessors: 0 },
  work: { pinnedNotes: 0, notesDoing: 0, notesInReview: 0, activeSelfImprovements: 0,
    shippedSelfImprovements: 0, enabledWatches: 0 }, knowledge: { activeMemoryEntries: 0, verifiedMemorySources: 0 } });

describe("automation agent tools", () => {
  it("exposes only registered playbooks and returns verified tool evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "ava-automation-tools-"));
    const db = openInMemoryDb();
    const service = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(), root,
      buildAutomationWorkflowRegistrations({ systemReportSnapshot: system, operationsBriefSnapshot: operations }));
    const tools = buildAutomationTools(service);
    expect(tools.map((entry) => entry.tool.name)).toEqual([
      "automation_system_report", "automation_operations_brief", "automation_status",
    ]);
    const result = await tools[1]!.run({}, { runId: "task-1" });
    expect(result).toMatchObject({ ok: true, verification: { state: "verified", scope: "task_outcome" } });
    expect(JSON.parse(result.text)).toMatchObject({ workflowId: "ava.operations-brief", status: "completed" });
    const status = JSON.parse((await tools[2]!.run({}, { runId: "task-2" })).text);
    expect(status.health.workflows.map((item: { workflow: { id: string } }) => item.workflow.id))
      .toEqual(["ava.system-report", "ava.operations-brief", "ava.approved-action-plan"]);
    await rm(root, { recursive: true, force: true });
    db.close();
  });
});
