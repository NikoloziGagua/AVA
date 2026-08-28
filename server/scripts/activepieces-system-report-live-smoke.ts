/**
 * Opt-in black-box acceptance test for AVA's genuine Activepieces workflow.
 *
 * Preconditions:
 * - AVA is running with ACTIVEPIECES_ENABLED=true.
 * - The genuine local Activepieces runtime and pinned system-report flow are up.
 *
 * Run from the repository root:
 *   npm.cmd -w server run smoke:activepieces-report
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { issueToken, revokeToken } from "../src/auth/tokens.js";
import { openDb } from "../src/state/db.js";
import { softDeleteSession } from "../src/state/sessions.js";

type StreamEvent = { event: string; data: Record<string, unknown> };

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const token = issueToken(db, { label: "activepieces-report-smoke" });
const auth = { authorization: `Bearer ${token.secret}` };
const base = `http://127.0.0.1:${cfg.port}`;
let sessionId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readSse(response: Response, timeoutMs = 90_000): Promise<StreamEvent[]> {
  assert(response.ok, `stream failed (${response.status})`);
  assert(response.body, "stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  let complete = false;
  const timer = setTimeout(() => void reader.cancel("Activepieces smoke timeout"), timeoutMs);
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
        events.push({ event, data: JSON.parse(data) as Record<string, unknown> });
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

async function main(): Promise<void> {
  try {
    const health = await fetch(`${base}/api/health`, { headers: auth });
    assert(health.ok, `AVA health failed (${health.status})`);

    const started = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        sessionId: null,
        text: "Run AVA's system health report.",
        voice: false,
        persist: false,
      }),
    });
    const start = await started.json() as { taskId?: string; sessionId?: string; error?: string };
    assert(started.ok, `chat failed (${started.status}): ${start.error ?? "unknown"}`);
    assert(start.taskId && start.sessionId, "chat did not return taskId/sessionId");
    sessionId = start.sessionId;

    const events = await readSse(await fetch(
      `${base}/api/chat/${encodeURIComponent(start.sessionId)}/stream?taskId=${encodeURIComponent(start.taskId)}`,
      { headers: auth },
    ));
    const calls = events.filter((event) => event.event === "tool_call");
    assert(calls.length === 1, `expected one tool call, got ${calls.length}`);
    assert(calls[0]!.data.tool === "automation_system_report",
      `AVA selected ${String(calls[0]!.data.tool)} instead of automation_system_report`);

    const result = events.find((event) => event.event === "tool_result")?.data;
    const verification = result?.verification as { state?: string; method?: string; scope?: string } | undefined;
    assert(result?.ok === true, "automation tool did not report success");
    assert(verification?.state === "verified", "automation result was not independently verified");
    assert(verification.method === "filesystem_readback_sha256", "unexpected verification method");
    assert(verification.scope === "task_outcome", "verification covered less than the requested outcome");

    const receipt = events.find((event) => event.event === "receipt")?.data;
    assert(receipt?.outcome === "verified", `task receipt outcome was ${String(receipt?.outcome)}`);
    assert(receipt.verificationScope === "task_outcome", "task receipt did not verify the requested outcome");
    const final = events.find((event) => event.event === "final")?.data.text;
    assert(typeof final === "string" && /report/i.test(final), "AVA emitted no report-oriented final response");

    const requestKey = `${start.taskId}:ava.system-report:v1`;
    const run = db.prepare("SELECT * FROM automation_runs WHERE request_key=?").get(requestKey) as {
      id: string; executor: string; status: string; artifact_path: string | null; artifact_hash: string | null;
      memory_entry_id: string | null; observability_run_id: string; verification_state: string;
    } | undefined;
    assert(run, "AVA did not persist the automation run");
    assert(run.executor === "activepieces", `run used ${run.executor} instead of genuine Activepieces`);
    assert(run.status === "completed", `automation run ended ${run.status}`);
    assert(run.verification_state === "verified", "persisted automation run was not verified");
    assert(run.artifact_path && run.artifact_hash, "verified run omitted its artifact evidence");
    const artifact = await readFile(run.artifact_path, "utf8");
    assert(sha256(artifact) === run.artifact_hash, "artifact no longer matches its verified SHA-256");
    assert(/# AVA System Health Report/.test(artifact), "artifact is not the pinned report output");
    assert(run.memory_entry_id, "verified artifact was not indexed in AVA memory");
    const memory = db.prepare(`SELECT e.status, s.source_type, s.source_ref, s.availability
      FROM memory_index_entries e JOIN memory_index_sources s ON s.entry_id=e.id WHERE e.id=?`)
      .get(run.memory_entry_id) as { status: string; source_type: string; source_ref: string; availability: string } | undefined;
    assert(memory?.status === "active" && memory.source_type === "automation_artifact" &&
      memory.availability === "verified", "memory index did not preserve verified artifact provenance");

    const mission = await fetch(
      `${base}/api/mission-control/runs/${encodeURIComponent(run.observability_run_id)}`,
      { headers: auth },
    );
    assert(mission.ok, `Mission Control child run lookup failed (${mission.status})`);
    const missionBody = await mission.json() as { run?: { status?: string; verificationStatus?: string }; events?: Array<{ type?: string }> };
    assert(missionBody.run?.status === "completed", "Mission Control child run was not completed");
    assert(missionBody.run.verificationStatus === "verified", "Mission Control child run was not verified");
    assert(missionBody.events?.some((event) => event.type === "automation.delegated"),
      "Mission Control omitted delegation evidence");
    assert(missionBody.events?.some((event) => event.type === "automation.completed"),
      "Mission Control omitted terminal evidence");

    // Reproduce the follow-up that previously told Sir the integration was
    // disabled. It must now inspect the same live service rather than answer
    // from documentation or a fixture assumption.
    const statusStarted = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        sessionId: start.sessionId,
        text: "Is Activepieces automation configured and available now?",
        voice: false,
        persist: false,
      }),
    });
    const statusStart = await statusStarted.json() as { taskId?: string; sessionId?: string; error?: string };
    assert(statusStarted.ok && statusStart.taskId && statusStart.sessionId,
      `status chat failed (${statusStarted.status}): ${statusStart.error ?? "unknown"}`);
    const statusEvents = await readSse(await fetch(
      `${base}/api/chat/${encodeURIComponent(statusStart.sessionId)}/stream?taskId=${encodeURIComponent(statusStart.taskId)}`,
      { headers: auth },
    ));
    const statusCalls = statusEvents.filter((event) => event.event === "tool_call");
    assert(statusCalls.length === 1 && statusCalls[0]!.data.tool === "automation_status",
      "AVA did not use automation_status for the availability question");
    const statusResult = statusEvents.find((event) => event.event === "tool_result")?.data;
    assert(statusResult?.ok === true && typeof statusResult.result === "string",
      "automation_status did not return a readable result");
    const statusPayload = JSON.parse(statusResult.result) as {
      health?: { configured?: boolean; available?: boolean; runtimeEvidence?: string };
      runs?: Array<{ id?: string; executor?: string; status?: string }>;
    };
    assert(statusPayload.health?.configured === true && statusPayload.health.available === true,
      "automation_status still reports Activepieces disabled or unavailable");
    assert(statusPayload.health.runtimeEvidence === "configured_endpoint",
      "automation_status mislabeled live configuration evidence");
    assert(statusPayload.runs?.some((item) => item.id === run.id && item.executor === "activepieces" && item.status === "completed"),
      "automation_status omitted the completed genuine Activepieces run");

    console.log(JSON.stringify({
      ok: true,
      taskId: start.taskId,
      automationRunId: run.id,
      executor: run.executor,
      status: run.status,
      verification: run.verification_state,
      artifactPath: run.artifact_path,
      artifactHash: run.artifact_hash,
      memoryEntryId: run.memory_entry_id,
      missionControlRunId: run.observability_run_id,
      tool: calls[0]!.data.tool,
      statusTool: statusCalls[0]!.data.tool,
      configured: statusPayload.health.configured,
      available: statusPayload.health.available,
    }, null, 2));
  } finally {
    if (sessionId) softDeleteSession(db, sessionId);
    revokeToken(db, token.id);
    db.close();
  }
}

await main();
