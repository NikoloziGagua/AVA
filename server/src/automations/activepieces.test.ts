import { describe, expect, it, vi } from "vitest";
import { ActivepiecesWebhookExecutor, AutomationExecutorError, parseAutomationExecutorResult } from "./activepieces.js";

const expected = { requestKey: "req-1", workflowId: "ava.system-report", workflowVersion: 1 };
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
      webhookToken: null, timeoutMs: 5_000 });
    await expect(disabled.execute({ ...expected, snapshot: snapshot(), signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "activepieces_unavailable" });
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ ...expected, snapshot: { counts: { people: 4 } } });
      expect(String(init?.body)).not.toContain("token-secret");
      return new Response(JSON.stringify(response), { status: 200 });
    });
    const active = new ActivepiecesWebhookExecutor({ enabled: true, systemReportWebhookUrl: "http://127.0.0.1:8080/hook",
      webhookToken: "token-secret", timeoutMs: 5_000 }, fetcher as typeof fetch);
    await expect(active.execute({ ...expected, snapshot: snapshot(), signal: new AbortController().signal }))
      .resolves.toMatchObject({ status: "succeeded", externalRunId: "ap-1" });
  });
});

function snapshot() {
  return { generatedAt: 1, ready: true, provider: "openai", core: { brainReady: true, voiceReady: true,
    browserReady: true, memoryReady: true }, counts: { preferences: 1, observations: 2, projects: 3,
      people: 4, playbooks: 5, watches: 6 }, integrations: { instagram: true, whatsapp: true, shopify: false,
      googlePlaces: false, screenVision: true, push: false, microsoftUfoAvailable: true } };
}
