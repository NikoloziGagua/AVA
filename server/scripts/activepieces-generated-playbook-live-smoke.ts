/**
 * Opt-in black-box acceptance for approval-gated generated playbooks.
 *
 * This deliberately performs one read-only real action: open Lasha's Instagram
 * chat through the saved `_princi150` profile. It never types or sends content.
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { issueToken, revokeToken } from "../src/auth/tokens.js";
import { listPeople } from "../src/apps/people.js";
import { openDb } from "../src/state/db.js";
import { softDeleteSession } from "../src/state/sessions.js";

type StreamEvent = { event: string; data: Record<string, unknown> };
type CandidateRow = {
  id: string; playbook_id: string; status: string; version: number;
  evidence_count: number; definition: string; validation_run_id: string | null;
};

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const token = issueToken(db, { label: "activepieces-generated-playbook-smoke" });
const auth = { authorization: `Bearer ${token.secret}` };
const base = `http://127.0.0.1:${cfg.port}`;
const sessions = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readSse(
  response: Response,
  onEvent?: (event: StreamEvent) => Promise<void>,
  timeoutMs = 120_000,
): Promise<StreamEvent[]> {
  assert(response.ok, `stream failed (${response.status})`);
  assert(response.body, "stream response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  let complete = false;
  const timer = setTimeout(() => void reader.cancel("generated playbook smoke timeout"), timeoutMs);
  try {
    while (!complete) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split("\n");
        const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!eventName || !data) continue;
        const event = { event: eventName, data: JSON.parse(data) as Record<string, unknown> };
        events.push(event);
        await onEvent?.(event);
        if (eventName === "done") complete = true;
      }
    }
  } finally {
    clearTimeout(timer);
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  assert(complete, "stream ended before AVA emitted done");
  return events;
}

async function chat(text: string, sessionId: string | null = null, approve = false): Promise<{
  taskId: string; sessionId: string; events: StreamEvent[];
}> {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ sessionId, text, voice: false, persist: false }),
  });
  const started = await response.json() as { taskId?: string; sessionId?: string; error?: string };
  assert(response.ok && started.taskId && started.sessionId,
    `chat failed (${response.status}): ${started.error ?? "unknown"}`);
  sessions.add(started.sessionId);
  const approved = new Set<string>();
  const events = await readSse(await fetch(
    `${base}/api/chat/${encodeURIComponent(started.sessionId)}/stream?taskId=${encodeURIComponent(started.taskId)}`,
    { headers: auth },
  ), async (event) => {
    if (event.event !== "approval_required" || !approve) return;
    const id = typeof event.data.id === "string" ? event.data.id : "";
    assert(id, "approval event omitted its identifier");
    if (approved.has(id)) return;
    approved.add(id);
    const decision = await fetch(`${base}/api/approvals/${encodeURIComponent(id)}/approve`, {
      method: "POST", headers: auth,
    });
    assert(decision.ok, `approval failed (${decision.status})`);
  });
  return { taskId: started.taskId, sessionId: started.sessionId, events };
}

function candidate(): CandidateRow | null {
  return db.prepare(`SELECT id,playbook_id,status,version,evidence_count,definition,validation_run_id
    FROM automation_playbook_candidates
    WHERE definition LIKE '%"expectedUsername":"_princi150"%'
    ORDER BY updated_at DESC LIMIT 1`).get() as CandidateRow | undefined ?? null;
}

function assertOpenOnly(events: StreamEvent[]): void {
  const calls = events.filter((event) => event.event === "tool_call")
    .map((event) => String(event.data.tool));
  assert(calls.includes("instagram_open_chat") || calls.includes("automation_run_playbook"),
    `AVA did not open the chat through an allowed tool: ${calls.join(", ")}`);
  assert(!calls.some((tool) => /send|type|press|click/i.test(tool)),
    `read-only acceptance unexpectedly used a message/input tool: ${calls.join(", ")}`);
  const result = events.findLast((event) => event.event === "tool_result")?.data;
  assert(result?.ok === true, "chat-opening tool did not report success");
  const verification = result.verification as { state?: string; method?: string } | undefined;
  assert(verification?.state === "verified" && verification.method === "instagram_thread_identity",
    `chat-opening evidence was not exact thread-identity verification (${verification?.method ?? "none"})`);
}

async function main(): Promise<void> {
  try {
    const health = await fetch(`${base}/api/health`, { headers: auth });
    assert(health.ok, `AVA health failed (${health.status})`);
    const lasha = listPeople(cfg.memoryDir).find((person) => person.name.toLowerCase() === "lasha" ||
      person.aliases.some((alias) => alias.toLowerCase() === "lasha"));
    assert(lasha?.instagram?.username?.replace(/^@/, "").toLowerCase() === "_princi150",
      "Lasha is not bound to the expected people-map username `_princi150`; refusing the live test");

    let current = candidate();
    let sessionId: string | null = null;
    while (!current || current.evidence_count < 2) {
      const opened = await chat("Open Lasha's Instagram chat.", sessionId);
      sessionId = opened.sessionId;
      assertOpenOnly(opened.events);
      const receipt = opened.events.find((event) => event.event === "receipt")?.data;
      assert(receipt?.outcome === "verified" && receipt.verificationScope === "task_outcome",
        "the observed chat-open task did not end with task-outcome verification");
      current = candidate();
    }
    assert(current.status === "proposed" || current.status === "failed" || current.status === "active",
      `candidate stayed ${current.status} after ${current.evidence_count} verified tasks`);

    if (current.status !== "active") {
      const activation = await chat(
        `Use automation_playbook_activate now with candidateId ${current.id} and expectedVersion ${current.version}.`,
        sessionId,
        true,
      );
      sessionId = activation.sessionId;
      const calls = activation.events.filter((event) => event.event === "tool_call");
      assert(calls.some((event) => event.data.tool === "automation_playbook_activate"),
        "AVA did not call the explicit activation tool");
      assert(activation.events.some((event) => event.event === "approval_required"),
        "activation did not cross the explicit approval boundary");
      assert(activation.events.some((event) => event.event === "approval_resolved" && event.data.status === "approved"),
        "activation approval was not resolved as approved");
      current = candidate();
      assert(current?.status === "active" && current.validation_run_id,
        `candidate did not become active (status=${current?.status ?? "missing"})`);
    }

    const active = current;
    const replay = await chat("Open Lasha's Instagram chat.", sessionId);
    assertOpenOnly(replay.events);
    const calls = replay.events.filter((event) => event.event === "tool_call");
    assert(calls.length === 1 && calls[0]!.data.tool === "automation_run_playbook",
      `active request bypassed its generated playbook (${calls.map((event) => event.data.tool).join(", ")})`);
    const toolResult = replay.events.find((event) => event.event === "tool_result")?.data;
    const resultPayload = JSON.parse(String(toolResult?.result ?? "{}")) as { playbookId?: string; planRunId?: string };
    assert(resultPayload.playbookId === active.playbook_id && resultPayload.planRunId,
      "generated execution did not identify its exact playbook and Activepieces plan run");
    const planRuns = db.prepare(`SELECT id,executor,status,verification_state FROM automation_runs
      WHERE workflow_id='ava.approved-action-plan' AND id IN (?,?)`)
      .all(active.validation_run_id, resultPayload.planRunId) as Array<{
        id: string; executor: string; status: string; verification_state: string;
      }>;
    assert(planRuns.length === 2 && planRuns.every((run) => run.executor === "activepieces" &&
      run.status === "completed" && run.verification_state === "verified"),
    "activation and execution were not both validated by genuine Activepieces with AVA read-back evidence");

    const duplicateCount = db.prepare(`SELECT COUNT(*) AS count FROM automation_playbook_candidates
      WHERE fingerprint=(SELECT fingerprint FROM automation_playbook_candidates WHERE id=?)`)
      .get(active.id) as { count: number };
    assert(duplicateCount.count === 1, "repeated observations created duplicate candidates");

    console.log(JSON.stringify({
      ok: true,
      playbookId: active.playbook_id,
      candidateId: active.id,
      status: active.status,
      evidenceCount: active.evidence_count,
      identity: "_princi150",
      activationPlanRunId: active.validation_run_id,
      executionPlanRunId: resultPayload.planRunId,
      executor: "activepieces",
      actionTool: "automation_run_playbook",
      verification: "instagram_thread_identity",
      communicationSent: false,
    }, null, 2));
  } finally {
    for (const sessionId of sessions) softDeleteSession(db, sessionId);
    revokeToken(db, token.id);
    db.close();
  }
}

await main();

