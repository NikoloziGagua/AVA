// Reads Niko's past conversations into the memory archive, oldest first, with
// the same extractor the running server uses for new conversations.
//
// Default is a dry run on a fresh COPY of the live database, written to
// data/scratch/memory-backfill.db, plus a readable report in data/eval/ (both
// gitignored: they contain personal facts). The live database is written only
// with --live.
//
//   npx tsx scripts/memory-backfill.ts [--sessions N] [--model gpt-5.6] [--effort medium] [--live]
import Database from "better-sqlite3";
import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/state/db.js";
import { MemoryArchive } from "../src/memory-archive/archive.js";
import { briefDay, renderBrief } from "../src/memory-archive/brief.js";
import { MemoryExtractor, openAIExtractionModel, type SkippedOperation } from "../src/memory-archive/extractor.js";
import { seedIndexTombstones } from "../src/memory-archive/migrate.js";
import type { MemoryRecord } from "../src/memory-archive/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const liveDb = join(repo, "server/data/state.db");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const live = process.argv.includes("--live");
  const reportOnly = process.argv.includes("--report-only");
  const target = live ? liveDb : join(repo, "data/scratch/memory-backfill.db");
  const cfg = loadConfig();
  if (!cfg.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!live && !reportOnly) {
    mkdirSync(dirname(target), { recursive: true });
    const source = new Database(liveDb, { readonly: true, fileMustExist: true });
    await source.backup(target);
    source.close();
  }
  const db = openDb(target);
  const archive = new MemoryArchive(db);
  const model = openAIExtractionModel(new OpenAI({ apiKey: cfg.openaiApiKey }), arg("model") ?? "gpt-5.6",
    (arg("effort") as "low" | "medium" | "high" | undefined) ?? "medium");
  const extractor = new MemoryExtractor(db, archive, model, { origin: "backfill", actor: "backfill" });
  const seeded = seedIndexTombstones(db, archive);
  const only = arg("session");
  const sessions = reportOnly ? [] : extractor.eligibleSessions()
    .filter((session) => !only || session.id === only)
    .slice(0, Number(arg("sessions") ?? Number.MAX_SAFE_INTEGER));
  console.log(`${live ? "LIVE" : "dry run on a copy"}: ${sessions.length} conversations; ${seeded.messages} messages from ${seeded.entries} forgotten index entries tombstoned`);
  const started = Date.now();
  const skipped: SkippedOperation[] = [];
  let batches = 0, proposed = 0, applied = 0;
  let failure: string | null = null;
  for (const [i, session] of sessions.entries()) {
    try {
      const report = await extractor.extractSession(session.id, { title: session.title });
      batches += report.batches; proposed += report.proposed; applied += report.applied.length;
      skipped.push(...report.skipped);
      console.log(`${i + 1}/${sessions.length} ${new Date(session.firstAt).toISOString().slice(0, 10)} batches ${report.batches}, proposed ${report.proposed}, applied ${report.applied.length}`);
    } catch (error) {
      // Progress is saved per batch: a rerun continues from here. Still write the report.
      failure = `stopped at conversation ${i + 1}/${sessions.length}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(failure);
      break;
    }
  }
  const now = Date.now();
  const all = db.prepare("SELECT id FROM memory_records ORDER BY said_at, seq").all() as Array<{ id: string }>;
  const records = all.map((row) => archive.get(row.id)!).filter(Boolean);
  const line = (r: MemoryRecord) => `- [${r.kind}] ${r.text} — topic "${r.topic}", ${r.speechAct}, ${r.confidence}${r.sensitive ? ", SENSITIVE" : ""}, said ${briefDay(r.saidAt, now)}, msgs ${r.sourceMessageIds.join(",")}${r.validTo ? `, until ${briefDay(r.validTo, now)}` : ""} (${r.id})`;
  const reasons = new Map<string, number>();
  for (const item of skipped) reasons.set(item.why, (reasons.get(item.why) ?? 0) + 1);
  const counts = archive.counts();
  const report = [
    `# Memory backfill report (${live ? "LIVE" : "dry run"}, ${new Date(now).toISOString()})`,
    "",
    `Model ${model.name}; ${sessions.length} conversations, ${batches} batches, ${proposed} proposed, ${applied} applied; ${Math.round((now - started) / 1000)} s.${failure ? ` ${failure}` : ""}`,
    `Archive: ${counts.active} current, ${counts.history} history, ${counts.unconfirmed} waiting for Niko, ${counts.forgotten} tombstones.`,
    "",
    "## Skipped proposals",
    ...[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => `- ${n} × ${why}`),
    "",
    "## The Brief AVA would load",
    "",
    "```",
    renderBrief({ current: archive.current(), ended: archive.endedSince(now - 14 * 86_400_000), now }),
    "```",
    "",
    "## Current",
    ...records.filter((r) => r.status === "active").map(line),
    "",
    "## Waiting for Niko",
    ...records.filter((r) => r.status === "unconfirmed").map(line),
    "",
    "## History",
    ...records.filter((r) => r.status === "history").map(line),
    "",
    "## Skipped (details)",
    ...skipped.map((item) => `- ${item.why}: [${item.op.op} ${item.op.kind}] ${item.op.text} (msgs ${item.op.sourceMessageIds.join(",")})`),
  ].join("\n");
  const out = arg("report") ?? join(repo, "data/eval/backfill-report.md");
  writeFileSync(out, report);
  console.log(`report: ${out}`);
  console.log(`archive: ${counts.active} current, ${counts.history} history, ${counts.unconfirmed} waiting, ${counts.forgotten} tombstones`);
  db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
