import { describe, expect, it, vi } from "vitest";
import { ActivepiecesWebhookExecutor, AutomationExecutorError, parseAutomationExecutorResult } from "./activepieces.js";

const expected = { requestKey: "req-1", workflowId: "ava.system-report", workflowVersion: 1 } as const;
const response = { schemaVersion: 1, ...expected, externalRunId: "ap-1", providerVersion: "0.1",
  status: "succeeded", steps: [{ id: "report", status: "completed", summary: "Built report", durationMs: 4 }],
  report: { title: "Health", markdown: "# Healthy\nsecret=sk-live-abcdefghijklmnopqrstuvwxyz" }, error: null };

describe("Activepieces pinned webhook adapter", () => {
  it("validates identity and scrubs bounded output", () => {
    const result = parseAutomationExecutorResult(response, expected);
    expect(result.report?.markdown).not.toContain("sk-live");
    expect(result.usage).toBe("not_reported");
  });

  it("rejects mismatched workflow responses", () => {
    expect(() => parseAutomationExecutorResult({ ...response, requestKey: "other" }, expected))
      .toThrowError(AutomationExecutorError);
  });

  it("fails closed when disabled and sends only the pinned bounded contract when configured", async () => {
    const disabled = new ActivepiecesWebhookExecutor({ enabled: false, systemReportWebhookUrl: null,
      operationsBriefWebhookUrl: null, webhookToken: null, timeoutMs: 5_000 });
    await expect(disabled.execute({ ...expected, snapshot: snapshot(), signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "activepieces_unavailable" });
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ ...expected, snapshot: { counts: { people: 4 } } });
      expect(String(init?.body)).not.toContain("token-secret");
      return new Response(JSON.stringify(response), { status: 200 });
    });
    const active = new ActivepiecesWebhookExecutor({ enabled: true, systemReportWebhookUrl: "http://127.0.0.1:8080/hook",
      operationsBriefWebhookUrl: "http://127.0.0.1:8080/brief", webhookToken: "token-secret", timeoutMs: 5_000 }, fetcher as typeof fetch);
    await expect(active.execute({ ...expected, snapshot: snapshot(), signal: new AbortController().signal }))
      .resolves.toMatchObject({ status: "succeeded", externalRunId: "ap-1" });
  });

  it("routes each registered workflow only to its own configured endpoint", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ...response, workflowId: body.workflowId,
        requestKey: body.requestKey, report: body.workflowId === "ava.operations-brief"
          ? { title: "AVA Operations Brief", markdown: "# AVA Operations Brief\n\n## Readiness\n\n## Last 24 hours\n\n## Attention\n\n## Work and knowledge\n" }
          : response.report }), { status: 200 });
    });
    const active = new ActivepiecesWebhookExecutor({ enabled: true,
      systemReportWebhookUrl: "http://127.0.0.1:8080/system",
      operationsBriefWebhookUrl: "http://127.0.0.1:8080/operations",
      webhookToken: null, timeoutMs: 5_000 }, fetcher as typeof fetch);
    await active.execute({ requestKey: "brief", workflowId: "ava.operations-brief", workflowVersion: 1,
      snapshot: operationsSnapshot(), signal: new AbortController().signal });
    expect(String(fetcher.mock.calls[0]![0])).toBe("http://127.0.0.1:8080/operations");
    expect(active.health()).toMatchObject({ configured: true, available: true,
      workflows: [{ configured: true }, { configured: true }] });
  });

  it("reports availability per workflow instead of hiding a missing endpoint", async () => {
    const partial = new ActivepiecesWebhookExecutor({ enabled: true,
      systemReportWebhookUrl: "http://127.0.0.1:8080/system",
      operationsBriefWebhookUrl: null, webhookToken: null, timeoutMs: 5_000 });
    expect(partial.health()).toMatchObject({ configured: true, available: true,
      workflows: [
        { workflow: { id: "ava.system-report" }, configured: true, available: true },
        { workflow: { id: "ava.operations-brief" }, configured: false, available: false },
      ] });
    await expect(partial.execute({ requestKey: "brief", workflowId: "ava.operations-brief", workflowVersion: 1,
      snapshot: operationsSnapshot(), signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "activepieces_unavailable" });
  });
});

function snapshot() {
  return { generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", ready: true, provider: "openai", core: { brainReady: true, voiceReady: true,
    browserReady: true, memoryReady: true }, counts: { preferences: 1, observations: 2, projects: 3,
      people: 4, playbooks: 5, watches: 6 }, integrations: { instagram: true, whatsapp: true, shopify: false,
      googlePlaces: false, screenVision: true, push: false, microsoftUfoAvailable: true } };
}

function operationsSnapshot() {
  return { generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", windowHours: 24 as const,
    readiness: { ready: true, provider: "openai", brainReady: true, voiceReady: true,
      browserReady: true, memoryReady: true }, recentRuns: { total: 1, active: 0, completed: 1,
      failed: 0, cancelled: 0, timedOut: 0, verified: 1, notVerified: 0 }, attention: {
      pendingApprovals: 0, blockedSelfImprovements: 0, blockedWatcherSuccessors: 0 }, work: {
      pinnedNotes: 0, notesDoing: 0, notesInReview: 0, activeSelfImprovements: 0,
      shippedSelfImprovements: 0, enabledWatches: 0 }, knowledge: {
      activeMemoryEntries: 0, verifiedMemorySources: 0 } };
}
