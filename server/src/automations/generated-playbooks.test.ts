import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { upsertPerson } from "../apps/people.js";
import { openInMemoryDb } from "../state/db.js";
import { DeterministicAutomationFixtureExecutor } from "./activepieces.js";
import { GeneratedPlaybookError, GeneratedPlaybookService } from "./generated-playbooks.js";
import { AutomationPlaybookService, buildAutomationWorkflowRegistrations } from "./playbooks.js";

const systemSnapshot = async () => ({ generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", ready: true,
  provider: "openai", core: { brainReady: true, voiceReady: true, browserReady: true, memoryReady: true },
  counts: { preferences: 0, observations: 0, projects: 0, people: 1, playbooks: 0, watches: 0 },
  integrations: { instagram: true, whatsapp: false, shopify: false, googlePlaces: false,
    screenVision: true, push: false, microsoftUfoAvailable: false } });
const operationsSnapshot = async () => ({ generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", windowHours: 24 as const,
  readiness: { ready: true, provider: "openai", brainReady: true, voiceReady: true, browserReady: true, memoryReady: true },
  recentRuns: { total: 0, active: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, verified: 0, notVerified: 0 },
  attention: { pendingApprovals: 0, blockedSelfImprovements: 0, blockedWatcherSuccessors: 0 },
  work: { pinnedNotes: 0, notesDoing: 0, notesInReview: 0, activeSelfImprovements: 0,
    shippedSelfImprovements: 0, enabledWatches: 0 }, knowledge: { activeMemoryEntries: 0, verifiedMemorySources: 0 } });

async function fixture(behavior: "success" | "failure" = "success") {
  const root = await mkdtemp(join(tmpdir(), "ava-generated-playbooks-"));
  const db = openInMemoryDb();
  const automation = new AutomationPlaybookService(db, new DeterministicAutomationFixtureExecutor(behavior), root,
    buildAutomationWorkflowRegistrations({ systemReportSnapshot: systemSnapshot, operationsBriefSnapshot: operationsSnapshot }));
  const execute = vi.fn(async () => ({ ok: true, text: "Opened Lasha's verified Instagram thread.", verification: {
    state: "verified" as const, scope: "task_outcome" as const, method: "instagram_thread_identity",
    summary: "The visible thread identity matched @\u005fprinci150.", evidenceRef: "thread-fixture", observedAt: Date.now(),
  } }));
  const service = new GeneratedPlaybookService(db, automation, root, execute);
  upsertPerson(root, { name: "Lasha", aliases: ["lash"], instagram: { username: "_princi150" } });
  return { root, db, automation, execute, service };
}

const verified = (method: string) => ({ state: "verified" as const, scope: "task_outcome" as const,
  method, summary: "The deterministic fixture independently verified this step." });
const verifiedStep = [{ tool: "instagram_open_chat", args: { person: "Lasha" }, ok: true,
  verification: verified("instagram_thread_identity") }];

describe("approval-gated generated automation playbooks", () => {
  it("requires two distinct verified observations, deduplicates replay, and binds the people-map identity", async () => {
    const f = await fixture();
    const first = f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open Lasha's Instagram chat",
      steps: verifiedStep, outcome: "verified" });
    expect(first).toMatchObject({ status: "observing", evidenceCount: 1,
      definition: { action: { tool: "instagram_open_chat", displayName: "Lasha", expectedUsername: "_princi150" } } });
    expect(f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open Lasha's Instagram chat",
      steps: verifiedStep, outcome: "verified" })).toMatchObject({ version: 1, evidenceCount: 1 });
    expect(f.service.observeVerifiedRun({ taskId: "task-failed", goal: "Open Lasha's Instagram chat",
      steps: verifiedStep, outcome: "failed" })).toBeNull();
    const proposed = f.service.observeVerifiedRun({ taskId: "task-two", goal: "Open Lasha's Instagram chat",
      steps: verifiedStep, outcome: "verified" });
    expect(proposed).toMatchObject({ status: "proposed", version: 2, evidenceCount: 2,
      evidenceTaskIds: ["task-one", "task-two"] });
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("validates the approved revision through Activepieces before running the exact allowlisted action", async () => {
    const f = await fixture();
    f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open Lasha's Instagram chat", steps: verifiedStep, outcome: "verified" });
    const proposed = f.service.observeVerifiedRun({ taskId: "task-two", goal: "Open Instagram chat with Lasha", steps: verifiedStep, outcome: "verified" })!;
    await expect(f.service.activate({ candidateId: proposed.id, expectedVersion: proposed.version - 1 }))
      .rejects.toMatchObject({ code: "stale_candidate" });
    const active = await f.service.activate({ candidateId: proposed.id, expectedVersion: proposed.version });
    expect(active).toMatchObject({ status: "active", revision: 1, validationRunId: expect.stringMatching(/^automation_/) });
    expect(f.automation.get(active.validationRunId!)).toMatchObject({ workflowId: "ava.approved-action-plan",
      status: "completed", verificationState: "verified", memoryEntryId: null });
    expect(f.service.matchActive("please open Lasha's Instagram chat")).toMatchObject({ id: active.id });
    const run = await f.service.run({ playbookId: active.playbookId, requestKey: "run-Lasha-once" });
    expect(run).toMatchObject({ candidate: { id: active.id }, planRunId: expect.stringMatching(/^automation_/),
      result: { ok: true, verification: { method: "instagram_thread_identity" } } });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({
      tool: "instagram_open_chat", displayName: "Lasha", expectedUsername: "_princi150",
    }) }), undefined, expect.stringMatching(/^automation_/));
    expect(f.service.matchActive("Search Google for AVA proof and open Lasha's Instagram chat")).toBeNull();
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("compiles, approves, and runs a heterogeneous ordered sequence", async () => {
    const f = await fixture();
    const steps = [
      { tool: "chrome_google_search", args: { query: "AVA multi step proof" }, ok: true,
        verification: verified("chrome_google_search_url") },
      ...verifiedStep,
    ];
    const first = f.service.observeVerifiedRun({ taskId: "sequence-one",
      goal: "Search Google for AVA multi step proof then open Lasha's Instagram chat", steps, outcome: "verified" });
    expect(first).toMatchObject({ status: "observing", definition: { schemaVersion: 2, kind: "tool_sequence",
      steps: [
        { id: "step-1", tool: "chrome_google_search", query: "AVA multi step proof" },
        { id: "step-2", tool: "instagram_open_chat", displayName: "Lasha", expectedUsername: "_princi150" },
      ] } });
    const proposed = f.service.observeVerifiedRun({ taskId: "sequence-two",
      goal: "Search Google for AVA multi step proof then open Lasha's Instagram chat", steps, outcome: "verified" })!;
    const active = await f.service.activate({ candidateId: proposed.id, expectedVersion: proposed.version });
    expect(f.service.matchActive("Open Lasha's Instagram chat")).toBeNull();
    expect(f.service.matchActive("Search Google for AVA multi step proof then open Lasha's Instagram chat"))
      .toMatchObject({ id: active.id });
    const plan = f.automation.get(active.validationRunId!);
    expect(plan?.inputSummary).toMatchObject({ sequence: { stepCount: 2, steps: [
      { id: "step-1", tool: "chrome_google_search", targetLabel: "Google search",
        targetFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { id: "step-2", tool: "instagram_open_chat", targetLabel: "Open a verified Instagram conversation",
        targetFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ] } });
    const run = await f.service.run({ playbookId: active.playbookId, requestKey: "sequence-run" });
    expect(run.result.ok).toBe(true);
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 2, kind: "tool_sequence",
      steps: expect.arrayContaining([expect.objectContaining({ tool: "chrome_google_search" }),
        expect.objectContaining({ tool: "instagram_open_chat" })]) }), undefined,
      expect.stringMatching(/^automation_/));
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("fails closed if the identity changes after approval and never reaches the browser action", async () => {
    const f = await fixture();
    f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open Lasha's Instagram chat", steps: verifiedStep, outcome: "verified" });
    const proposed = f.service.observeVerifiedRun({ taskId: "task-two", goal: "Open Lasha's Instagram chat", steps: verifiedStep, outcome: "verified" })!;
    const active = await f.service.activate({ candidateId: proposed.id, expectedVersion: proposed.version });
    upsertPerson(f.root, { name: "Lasha", instagram: { username: "changed_identity" } });
    await expect(f.service.run({ playbookId: active.playbookId, requestKey: "identity-changed" }))
      .rejects.toMatchObject({ code: "identity_changed" });
    expect(f.execute).not.toHaveBeenCalled();
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("records failed Activepieces validation and recovers interrupted validation conservatively", async () => {
    const f = await fixture("failure");
    f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open Lasha's Instagram chat", steps: verifiedStep, outcome: "verified" });
    const proposed = f.service.observeVerifiedRun({ taskId: "task-two", goal: "Open Lasha's Instagram chat", steps: verifiedStep, outcome: "verified" })!;
    await expect(f.service.activate({ candidateId: proposed.id, expectedVersion: proposed.version }))
      .rejects.toMatchObject({ code: "activepieces_validation_failed" });
    expect(f.service.get(proposed.id)).toMatchObject({ status: "failed", errorCode: "activepieces_validation_failed" });
    f.db.prepare("UPDATE automation_playbook_candidates SET status='validating' WHERE id=?").run(proposed.id);
    const restarted = new GeneratedPlaybookService(f.db, f.automation, f.root, f.execute);
    expect(restarted.get(proposed.id)).toMatchObject({ status: "failed", errorCode: "interrupted_by_restart" });
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("does not compile failed, unverified, excessive, consequential, or unsupported procedures", async () => {
    const f = await fixture();
    expect(f.service.observeVerifiedRun({ taskId: "task-one", goal: "Open chat",
      steps: [{ ...verifiedStep[0]!, ok: false }], outcome: "verified" })).toBeNull();
    expect(f.service.observeVerifiedRun({ taskId: "task-two", goal: "Open and send",
      steps: [...verifiedStep, { tool: "instagram_send", args: { text: "hi" }, ok: true,
        verification: verified("instagram_message_dom") }], outcome: "verified" })).toBeNull();
    expect(f.service.observeVerifiedRun({ taskId: "task-three", goal: "Read a file",
      steps: [{ tool: "fs_read", args: { path: "x" }, ok: true,
        verification: verified("fs_readback") }], outcome: "verified" })).toBeNull();
    expect(f.service.observeVerifiedRun({ taskId: "task-four", goal: "Unverified search",
      steps: [{ tool: "chrome_google_search", args: { query: "AVA" }, ok: true }], outcome: "verified" })).toBeNull();
    expect(f.service.observeVerifiedRun({ taskId: "task-five", goal: "Too many searches",
      steps: Array.from({ length: 7 }, (_, i) => ({ tool: "chrome_google_search",
        args: { query: `AVA ${i}` }, ok: true, verification: verified("chrome_google_search_url") })),
      outcome: "verified" })).toBeNull();
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });

  it("scrubs observed trigger text and persists no tool output or credentials", async () => {
    const f = await fixture();
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const candidate = f.service.observeVerifiedRun({ taskId: "task-secret", goal: `Open Lasha's chat ${secret}`,
      steps: verifiedStep, outcome: "verified" })!;
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("sk-***");
    expect(serialized).not.toContain("Opened Lasha's verified Instagram thread");
    expect(f.service.observeVerifiedRun({ taskId: "task-secret-query", goal: "Search safely",
      steps: [{ tool: "chrome_google_search", args: { query: secret }, ok: true,
        verification: verified("chrome_google_search_url") }], outcome: "verified" })).toBeNull();
    expect(f.service.observeVerifiedRun({ taskId: "task-secret-url", goal: "Open safely",
      steps: [{ tool: "chrome_open_url", args: { url: "https://user:password@example.com/private" }, ok: true,
        verification: verified("chrome_open_url") }], outcome: "verified" })).toBeNull();
    await rm(f.root, { recursive: true, force: true }); f.db.close();
  });
});
