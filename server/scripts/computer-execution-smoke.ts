/**
 * Opt-in black-box smoke for AVA's deterministic computer executor route.
 *
 * Talks to the already-running authenticated AVA server, drives the real
 * persistent browser, reads task receipts and Mission Control, and removes its
 * temporary device/session records. It deliberately performs no communication
 * with another person or account.
 *
 * Run from the repository root:
 *   npm.cmd -w server run smoke:computer-routing
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { issueToken, revokeToken } from "../src/auth/tokens.js";
import { openDb } from "../src/state/db.js";
import { softDeleteSession } from "../src/state/sessions.js";

type StreamEvent = { event: string; data: Record<string, unknown> };
type ChatRun = {
  taskId: string;
  sessionId: string;
  durationMs: number;
  events: StreamEvent[];
  final: string;
  receipt: Record<string, unknown>;
  mission: {
    run: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  };
};

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const token = issueToken(db, { label: "computer-routing-smoke" });
const auth = { authorization: `Bearer ${token.secret}` };
const base = `http://127.0.0.1:${cfg.port}`;
const sessions = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readSse(response: Response, timeoutMs = 60_000): Promise<StreamEvent[]> {
  assert(response.ok, `stream failed (${response.status})`);
  assert(response.body, "stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  let complete = false;
  const timer = setTimeout(() => void reader.cancel("smoke timeout"), timeoutMs);
  try {
    while (!complete) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!event || !data) continue;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        events.push({ event, data: parsed });
        if (event === "done") complete = true;
      }
    }
  } finally {
    clearTimeout(timer);
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  assert(complete, "stream ended before AVA emitted done");
  return events;
}

async function runChat(text: string, voice = false): Promise<ChatRun> {
  const startedAt = Date.now();
  const started = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ text, sessionId: null, voice, persist: false }),
  });
  const startBody = await started.json() as { taskId?: string; sessionId?: string; error?: string };
  assert(started.ok, `chat failed (${started.status}): ${startBody.error ?? "unknown"}`);
  assert(startBody.taskId && startBody.sessionId, "chat did not return taskId/sessionId");
  sessions.add(startBody.sessionId);

  const events = await readSse(await fetch(
    `${base}/api/chat/${encodeURIComponent(startBody.sessionId)}/stream?taskId=${encodeURIComponent(startBody.taskId)}`,
    { headers: auth },
  ));
  const final = events.find((event) => event.event === "final")?.data.text;
  const receipt = events.find((event) => event.event === "receipt")?.data;
  assert(typeof final === "string" && final.length > 0, "AVA emitted no final response");
  assert(receipt, "AVA emitted no task receipt");

  const missionResponse = await fetch(
    `${base}/api/mission-control/runs/${encodeURIComponent(startBody.taskId)}`,
    { headers: auth },
  );
  assert(missionResponse.ok, `Mission Control run lookup failed (${missionResponse.status})`);
  const mission = await missionResponse.json() as ChatRun["mission"];
  return {
    taskId: startBody.taskId,
    sessionId: startBody.sessionId,
    durationMs: Date.now() - startedAt,
    events,
    final,
    receipt,
    mission,
  };
}

function assertVerifiedSearch(run: ChatRun, expectedQuery: string): void {
  const calls = run.events.filter((event) => event.event === "tool_call");
  assert(calls.length === 1, `expected one tool call, got ${calls.length}`);
  assert(calls[0]!.data.tool === "chrome_google_search", "AVA did not select chrome_google_search");
  assert((calls[0]!.data.args as { query?: string } | undefined)?.query === expectedQuery,
    "tool query did not match the literal request");
  const result = run.events.find((event) => event.event === "tool_result")?.data;
  const verification = result?.verification as { state?: string; method?: string } | undefined;
  assert(result?.ok === true, "browser executor did not report success");
  assert(verification?.state === "verified", "browser result was not independently verified");
  assert(verification.method === "chrome_google_search_url", "unexpected verification method");
  assert(run.receipt.outcome === "verified", "task receipt was not verified");
  assert(run.receipt.verificationScope === "task_outcome", "receipt verified only an operation/response");
  assert(run.mission.run.verificationStatus === "verified", "Mission Control projection was not verified");
  assert(run.mission.events.some((event) => event.type === "verification.evidence.recorded"),
    "Mission Control omitted verification provenance");
  assert(!run.mission.events.some((event) => event.type === "provider.usage.recorded"),
    "deterministic route unexpectedly invoked a model provider");
}

async function assertBrowserQuery(query: string): Promise<void> {
  const response = await fetch("http://127.0.0.1:9222/json/list");
  assert(response.ok, "persistent browser CDP endpoint is unavailable");
  const pages = await response.json() as Array<{ type?: string; url?: string }>;
  const found = pages.some((page) => {
    if (page.type !== "page" || typeof page.url !== "string") return false;
    try {
      const url = new URL(page.url);
      return /^(?:www\.)?google\.(?:com|co\.uk)$/i.test(url.hostname)
        && url.pathname === "/search"
        && url.searchParams.get("q") === query;
    } catch {
      return false;
    }
  });
  assert(found, "CDP did not show the exact requested Google results URL");
}

async function main(): Promise<void> {
  const typedQuery = "AVA ROUTER LIVE 2026-08-28";
  const voiceQuery = "AVA VOICE ROUTER LIVE 2026-08-28";
  try {
    const typed = await runChat(`Open Google and search for ${typedQuery}`);
    assertVerifiedSearch(typed, typedQuery);
    console.log(`typed: verified in ${typed.durationMs}ms (${typed.taskId})`);

    const repeat = await runChat(`Open Google and search for ${typedQuery}`);
    assertVerifiedSearch(repeat, typedQuery);
    console.log(`repeat: verified in ${repeat.durationMs}ms (${repeat.taskId})`);

    const voice = await runChat(`Open Google and search for ${voiceQuery}`, true);
    assertVerifiedSearch(voice, voiceQuery);
    await assertBrowserQuery(voiceQuery);
    console.log(`voice-originated: verified in ${voice.durationMs}ms (${voice.taskId})`);

    const unsupported = await runChat("Use Microsoft UFO to open Google and search for AVA");
    assert(!unsupported.events.some((event) => event.event === "tool_call"),
      "unsupported UFO request dispatched a tool");
    assert(/didn't run Microsoft UFO|cannot operate Google or a browser/i.test(unsupported.final),
      "unsupported UFO request was not explained honestly");
    assert(unsupported.receipt.verificationScope === "response_delivery",
      "unsupported request claimed external task verification");
    assert(unsupported.mission.run.verificationStatus !== "verified",
      "Mission Control claimed unsupported external work was verified");
    console.log(`unsupported-UFO: no action dispatched (${unsupported.taskId})`);

    console.log("computer execution smoke: PASS");
  } finally {
    for (const sessionId of sessions) softDeleteSession(db, sessionId);
    revokeToken(db, token.id);
    db.close();
  }
}

await main();
