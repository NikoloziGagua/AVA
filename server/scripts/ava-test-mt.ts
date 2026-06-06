// Multi-turn live behavioral harness for Ava. Each task is a SEQUENCE of turns
// sharing one session: turn 1 opens the session, later turns reuse its sessionId,
// so we observe context retention, correction handling, reference resolution, and
// resistance to pressure across turns.
//   run: (from server/)  npx tsx scripts/ava-test-mt.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/state/db.js";
import { issueToken } from "../src/auth/tokens.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const token = issueToken(db, { label: "ava-test-mt" }).secret;
const BASE = `http://127.0.0.1:${cfg.port}`;
const auth = { authorization: `Bearer ${token}` };

type Task = { id: string; turns: string[] };
type TurnResult = { text: string; final?: string; tools: string[]; errors: string[]; ms: number };

async function runTurn(sessionId: string | null, text: string, timeoutMs = 150_000): Promise<{ sessionId?: string; r: TurnResult }> {
  const r: TurnResult = { text, tools: [], errors: [], ms: 0 };
  const t0 = Date.now();
  try {
    const post = await fetch(`${BASE}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ sessionId, text }),
    });
    const started = (await post.json()) as { sessionId?: string };
    const sid = started.sessionId;
    if (!sid) { r.errors.push("no sessionId"); r.ms = Date.now() - t0; return { r }; }
    const res = await fetch(`${BASE}/api/chat/${sid}/stream`, { headers: auth });
    const reader = res.body?.getReader();
    if (!reader) { r.errors.push("no stream"); r.ms = Date.now() - t0; return { sessionId: sid, r }; }
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
            if (cur === "tool_call") r.tools.push((JSON.parse(data) as { tool: string }).tool);
            else if (cur === "final") { r.final = (JSON.parse(data) as { text: string }).text; stop = true; }
            else if (cur === "error") { r.errors.push(data.slice(0, 200)); stop = true; }
            else if (cur === "done") stop = true;
          } catch { /* */ }
        }
      }
    }
    if (Date.now() >= deadline) r.errors.push("TIMEOUT");
    try { await reader.cancel(); } catch { /* */ }
    r.ms = Date.now() - t0;
    return { sessionId: sid, r };
  } catch (e) { r.errors.push(e instanceof Error ? e.message : String(e)); r.ms = Date.now() - t0; return { r }; }
}

async function main(): Promise<void> {
  const tasks = JSON.parse(readFileSync(process.env.AVA_TASKS ?? "ava-mt-tasks.json", "utf8")) as Task[];
  const out: Array<{ id: string; turns: TurnResult[] }> = [];
  for (const t of tasks) {
    process.stdout.write(`\n=== [${t.id}] ${t.turns.length} turns ===\n`);
    let sid: string | null = null;
    const turns: TurnResult[] = [];
    for (let i = 0; i < t.turns.length; i++) {
      const { sessionId, r } = await runTurn(sid, t.turns[i]);
      if (sessionId) sid = sessionId;
      turns.push(r);
      process.stdout.write(`  T${i + 1} (${r.ms}ms, tools=${r.tools.join(",") || "none"}${r.errors.length ? ", ERR=" + r.errors.join("|").slice(0, 60) : ""})\n`);
      process.stdout.write(`     Q: ${r.text.slice(0, 90)}\n`);
      process.stdout.write(`     A: ${(r.final || "(none)").replace(/\s+/g, " ").slice(0, 200)}\n`);
    }
    out.push({ id: t.id, turns });
    writeFileSync(process.env.AVA_RESULTS ?? "ava-mt-results.json", JSON.stringify(out, null, 2));
  }
  const errs = out.reduce((n, t) => n + t.turns.filter((x) => x.errors.length).length, 0);
  process.stdout.write(`\n==== DONE: ${out.length} sequences, ${out.reduce((n, t) => n + t.turns.length, 0)} turns | turn-errors: ${errs} ====\n`);
}
main().catch((e) => console.log("ERR", e instanceof Error ? e.stack : e));
