// Live behavioral test harness for Ava. Mints a token, POSTs each task to the
// real /api/chat agent, reads the SSE run, and records what Ava did (final reply,
// tools used, approvals, errors, timing). Sequential so we observe one at a time.
//   run:  (from server/)  npx tsx scripts/ava-test.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/state/db.js";
import { issueToken } from "../src/auth/tokens.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const token = issueToken(db, { label: "ava-test" }).secret;
const BASE = `http://127.0.0.1:${cfg.port}`;
const auth = { authorization: `Bearer ${token}` };

type Task = { id: string; task: string };
type Result = {
  id: string; task: string; sessionId?: string; final?: string;
  tools: { tool: string; args?: unknown }[]; approvals: string[];
  errors: string[]; killed?: boolean; durationMs: number;
};

async function runTask(t: Task, timeoutMs = 150_000): Promise<Result> {
  const r: Result = { id: t.id, task: t.task, tools: [], approvals: [], errors: [], durationMs: 0 };
  const t0 = Date.now();
  try {
    const post = await fetch(`${BASE}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ sessionId: null, text: t.task }),
    });
    const started = (await post.json()) as { sessionId?: string };
    const sid = started.sessionId; r.sessionId = sid;
    if (!sid) { r.errors.push("no sessionId from POST"); r.durationMs = Date.now() - t0; return r; }
    const res = await fetch(`${BASE}/api/chat/${sid}/stream`, { headers: auth });
    const reader = res.body?.getReader();
    if (!reader) { r.errors.push("no stream body"); r.durationMs = Date.now() - t0; return r; }
    const dec = new TextDecoder(); let buf = "", cur = "", stop = false;
    const deadline = Date.now() + timeoutMs;
    while (!stop && Date.now() < deadline) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) cur = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          try {
            if (cur === "tool_call") { const p = JSON.parse(data) as { tool: string; args?: unknown }; r.tools.push({ tool: p.tool, args: p.args }); }
            else if (cur === "approval_required") { const p = JSON.parse(data) as { tool: string; summary: string }; r.approvals.push(`${p.tool}: ${p.summary}`); }
            else if (cur === "final") { r.final = (JSON.parse(data) as { text: string }).text; stop = true; }
            else if (cur === "error") { r.errors.push(data.slice(0, 300)); stop = true; }
            else if (cur === "killed") { r.killed = true; stop = true; }
            else if (cur === "done") { stop = true; }
          } catch { /* ignore non-JSON */ }
        }
      }
    }
    if (Date.now() >= deadline) r.errors.push("TIMEOUT");
    try { await reader.cancel(); } catch { /* */ }
  } catch (e) { r.errors.push(e instanceof Error ? e.message : String(e)); }
  r.durationMs = Date.now() - t0; return r;
}

async function main(): Promise<void> {
  const tasksPath = process.env.AVA_TASKS ?? "ava-test-tasks.json";
  const resultsPath = process.env.AVA_RESULTS ?? "ava-test-results.json";
  const tasks = JSON.parse(readFileSync(tasksPath, "utf8")) as Task[];
  const results: Result[] = [];
  for (const t of tasks) {
    process.stdout.write(`\n[${t.id}] ${t.task.slice(0, 70)}\n`);
    const r = await runTask(t);
    results.push(r);
    const toolStr = r.tools.map((x) => x.tool).join(",") || "none";
    process.stdout.write(`  -> ${r.errors.length ? "ERR(" + r.errors.join("|").slice(0, 80) + ")" : "ok"} | tools=${toolStr} | ${r.durationMs}ms\n`);
    process.stdout.write(`  final: ${(r.final || "(none)").replace(/\s+/g, " ").slice(0, 240)}\n`);
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  }
  process.stdout.write(`\n==== DONE: ${results.length} tasks | errors: ${results.filter((r) => r.errors.length).length} | killed: ${results.filter((r) => r.killed).length} ====\n`);
}
main().catch((e) => console.log("ERR", e instanceof Error ? e.stack : e));
