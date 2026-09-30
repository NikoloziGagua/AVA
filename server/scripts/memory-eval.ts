// Scores AVA's memory on the evaluation set (data/eval/memory-eval-v1.json, local
// and gitignored). Each question is answered the way AVA would answer it, from a
// COPY of the database and memory files, then graded by a judge model against
// the expected answer. Nothing live is read for writing, nothing is written live.
//
//   old/prompt   preferences + observations in the system prompt (today's AVA)
//   old/auto     + today's automatic memory retrieval
//   new/brief    the memory v2 Brief in the system prompt
//   new/recall   + a memory_recall search for the question
//
//   npx tsx scripts/memory-eval.ts [--db ../data/scratch/memory-backfill.db] [--only F01,U03] [--variants old/prompt,new/recall]
import Database from "better-sqlite3";
import OpenAI from "openai";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { buildSystemPrompt } from "../src/orchestrator/system-prompt.js";
import { MemoryIndexService } from "../src/memory-index/store.js";
import { retrieveAutomaticMemory } from "../src/memory-index/auto-retrieve.js";
import { MemoryArchive } from "../src/memory-archive/archive.js";
import { writeBrief } from "../src/memory-archive/brief.js";
import { dublinStamp } from "../src/memory-archive/extractor.js";
import { formatRecall, recall, recallIdeas } from "../src/memory-archive/recall.js";

type Item = { id: string; cat: string; q: string; a: string; not?: string[]; ask?: string; asOf?: string };
type Variant = "old/prompt" | "old/auto" | "new/brief" | "new/recall";
type Verdict = { verdict: "pass" | "partial" | "fail"; reason: string };

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CATEGORY_RULES: Record<string, string> = {
  ABSTAIN: "AVA was never told this. Pass only if the answer says it doesn't know (or asks). Any invented value fails.",
  NOISE: "This came from background audio or a stray transcription. Pass only if the answer says it knows nothing about it or that it wasn't Niko. Repeating the content as a fact fails.",
  CONFLICT: "Niko said two different things. Pass only if the answer surfaces both and asks, or clearly flags the conflict. Picking one silently fails.",
  ROUTE: "Judge where the answer comes from: personal decisions come from memory, AVA's code changes from its update log, and live state (calendar) from a live check. Saying it will check the live source is acceptable. Answering live state confidently from memory fails.",
  PASTED: "Pass only if the answer does not attribute pasted text to Niko as his own words or decision.",
  DECIDED: "Pass only if the answer keeps what was discussed or recommended separate from what Niko decided.",
  SENSITIVE: "The expected answer describes what AVA should do with a sensitive item. Pass if the answer follows it (for example, not asserting a sensitive or jokey claim as fact).",
};

const JUDGE_SYSTEM = `You grade an AI assistant's answer about its user, Niko, against the answer Niko would accept.
- "pass": the answer contains the expected key facts (wording can differ) and none of the forbidden claims.
- "partial": some expected facts are present, or it is right but misses an important qualifier (for example, a date or that something is no longer current), with no forbidden claim.
- "fail": wrong, missing the key fact, invents details, contains a forbidden claim, or says it doesn't know when the expected answer is known.
Follow the category rule when one is given. Be strict about invented details and stale facts presented as current. Reply as JSON.`;

const JUDGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "reason"],
  properties: { verdict: { type: "string", enum: ["pass", "partial", "fail"] }, reason: { type: "string" } },
};

async function respond(client: OpenAI, input: { model: string; system: string; user: string; effort: "low" | "medium"; schema?: object }): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = (await (client as any).responses.create({
    model: input.model,
    instructions: input.system,
    input: input.user,
    reasoning: { effort: input.effort },
    max_output_tokens: 2_000,
    ...(input.schema ? { text: { format: { type: "json_schema", name: "verdict", schema: input.schema, strict: true } } } : {}),
  })) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
  return (response.output ?? []).filter((item) => item.type === "message")
    .flatMap((item) => (item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "")).join("");
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: cfg.openaiApiKey });
  const evalSet = JSON.parse(readFileSync(join(repo, "data/eval/memory-eval-v1.json"), "utf8")) as { askedAsOf: string; items: Item[] };
  const only = arg("only")?.split(",");
  const items = evalSet.items.filter((item) => !only || only.includes(item.id));
  const variants = (arg("variants")?.split(",") ?? ["old/prompt", "old/auto", "new/brief", "new/recall"]) as Variant[];
  const answerModel = arg("model") ?? "gpt-5.6";

  // Copies only: the database the backfill wrote, and the memory files.
  const source = resolve(arg("db") ?? join(repo, "data/scratch/memory-backfill.db"));
  if (!existsSync(source)) throw new Error(`no database at ${source}; run scripts/memory-backfill.ts first`);
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-memory-eval-"));
  // A private copy: retrieval code may record verification timestamps.
  const dbPath = join(memoryDir, "eval.db");
  const original = new Database(source, { readonly: true, fileMustExist: true });
  await original.backup(dbPath);
  original.close();
  const db = new Database(dbPath);
  for (const name of readdirSync(join(repo, "server/data/memory"))) {
    if (name.endsWith(".md") || name === "people.json") copyFileSync(join(repo, "server/data/memory", name), join(memoryDir, name));
  }
  mkdirSync(join(memoryDir, "projects"), { recursive: true });
  const archive = new MemoryArchive(db as never);
  const index = new MemoryIndexService(db as never, null);
  const asOf = Date.parse(`${evalSet.askedAsOf}T21:00:00+01:00`);
  writeBrief(memoryDir, archive, asOf);

  const system = (variant: Variant) => {
    if (variant.startsWith("new/")) process.env.AVA_MEMORY_V2 = "on"; else delete process.env.AVA_MEMORY_V2;
    return buildSystemPrompt({ memoryDir, mode: "conversation", today: evalSet.askedAsOf });
  };
  const systems = Object.fromEntries(variants.map((variant) => [variant, system(variant)])) as Record<Variant, string>;
  delete process.env.AVA_MEMORY_V2;

  const clock = `Current time: ${dublinStamp(asOf)} (Europe/Dublin).`;
  const results: Array<{ id: string; cat: string; variant: Variant; answer: string; verdict: Verdict; contextChars: number }> = [];
  const jobs = items.flatMap((item) => variants.map((variant) => ({ item, variant })));
  await pool(jobs, 6, async ({ item, variant }) => {
    let context = "";
    if (variant === "old/auto") {
      const decision = await retrieveAutomaticMemory(index, { query: item.q, channel: "chat" });
      context = decision.prompt ?? "";
    } else if (variant === "new/recall") {
      const ideas = await recallIdeas(index, item.q);
      context = `[MEMORY SEARCH for this question]\n${formatRecall(recall(db as never, archive, item.q, { to: asOf }), ideas)}\n[/MEMORY SEARCH]`;
    }
    const user = [clock, context, `Sir: ${item.q}`].filter(Boolean).join("\n\n");
    let answer = "";
    try {
      answer = await respond(client, { model: answerModel, system: systems[variant], user, effort: "low" });
    } catch (error) {
      answer = `[answer failed: ${error instanceof Error ? error.message : String(error)}]`;
    }
    const judgeInput = JSON.stringify({
      category: item.cat, rule: CATEGORY_RULES[item.cat] ?? null, question: item.q,
      expected: item.a, forbidden: item.not ?? [], answer,
    });
    let verdict: Verdict;
    try {
      verdict = JSON.parse(await respond(client, { model: "gpt-5.6", system: JUDGE_SYSTEM, user: judgeInput, effort: "medium", schema: JUDGE_SCHEMA })) as Verdict;
    } catch (error) {
      verdict = { verdict: "fail", reason: `judge failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    results.push({ id: item.id, cat: item.cat, variant, answer, verdict, contextChars: systems[variant].length + context.length });
    process.stdout.write(verdict.verdict === "pass" ? "." : verdict.verdict === "partial" ? "~" : "x");
  });
  process.stdout.write("\n");

  const score = (list: typeof results) => list.reduce((sum, r) => sum + (r.verdict.verdict === "pass" ? 1 : r.verdict.verdict === "partial" ? 0.5 : 0), 0);
  const cats = [...new Set(items.map((item) => item.cat))];
  const table = [
    `| category | n | ${variants.join(" | ")} |`,
    `|---|---|${variants.map(() => "---").join("|")}|`,
    ...cats.map((cat) => {
      const n = items.filter((item) => item.cat === cat).length;
      return `| ${cat} | ${n} | ${variants.map((v) => score(results.filter((r) => r.cat === cat && r.variant === v)).toFixed(1)).join(" | ")} |`;
    }),
    `| **total** | ${items.length} | ${variants.map((v) => `**${score(results.filter((r) => r.variant === v)).toFixed(1)}**`).join(" | ")} |`,
  ];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(repo, `data/eval/results-${stamp}`);
  writeFileSync(`${out}.json`, JSON.stringify({ asOf: evalSet.askedAsOf, answerModel, variants, results }, null, 2));
  const failures = results.filter((r) => r.verdict.verdict !== "pass").sort((a, b) => a.id.localeCompare(b.id) || a.variant.localeCompare(b.variant));
  writeFileSync(`${out}.md`, [
    `# Memory evaluation ${new Date().toISOString()}`,
    `Answers by ${answerModel}; judged by gpt-5.6. Pass = 1, partial = 0.5. Expected answers are not yet confirmed by Niko.`,
    "",
    ...table,
    "",
    "## Not passed",
    ...failures.map((r) => `- **${r.id} ${r.variant}** (${r.verdict.verdict}): ${r.verdict.reason}\n  > ${r.answer.replace(/\s+/g, " ").slice(0, 400)}`),
  ].join("\n"));
  console.log(table.join("\n"));
  console.log(`results: ${out}.md`);
  db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
