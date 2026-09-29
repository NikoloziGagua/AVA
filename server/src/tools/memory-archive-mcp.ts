import type { ToolDef } from "./ava-mcp.js";
import type { Db } from "../state/db.js";
import type { MemoryArchive } from "../memory-archive/archive.js";
import { readBrief } from "../memory-archive/brief.js";
import { dublinDue, dublinStamp } from "../memory-archive/extractor.js";
import { formatRecall, recall } from "../memory-archive/recall.js";
import { MEMORY_KINDS, type MemoryKind, type MemoryRecord, type MemoryWriteResult } from "../memory-archive/types.js";

// Memory v2 tools: what the agent calls when Niko says "remember", "that's
// wrong", "forget it", "stop bringing that up", or asks about the past. Each
// write goes straight to the archive (no background queue) and the reply is
// built from the record read back, so "done" is only said after it is done.

export type MemoryArchiveToolDeps = {
  db: Db;
  archive: MemoryArchive;
  memoryDir: string;
  sessionId?: string | null;
};

function kindOf(value: unknown): MemoryKind | null {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value) ? value as MemoryKind : null;
}

/** Niko's latest message in this conversation: the source of an explicit request. */
function latestNikoMessage(deps: MemoryArchiveToolDeps): { id: number; createdAt: number } | null {
  if (!deps.sessionId) return null;
  const row = deps.db.prepare("SELECT id, created_at FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1")
    .get(deps.sessionId) as { id: number; created_at: number } | undefined;
  return row ? { id: row.id, createdAt: row.created_at } : null;
}

function describe(record: MemoryRecord): string {
  return `[${record.id}] ${record.text} (${record.kind}, topic "${record.topic}", ${record.status}, said ${dublinStamp(record.saidAt)})`;
}

function writeReply(result: MemoryWriteResult, verb: string): { ok: boolean; text: string } {
  if (!result.ok) return { ok: false, text: `Not saved: ${result.message}` };
  if (result.outcome === "unchanged") return { ok: true, text: `Already known, nothing changed: ${describe(result.record)}` };
  const replaced = result.replaced.length
    ? ` It replaces ${result.replaced.map((record) => `"${record.text}"`).join(", ")}, which is kept as history.`
    : "";
  return { ok: true, text: `${verb}: ${describe(result.record)}.${replaced}` };
}

/** Finds the one current memory a phrase refers to, or explains why it can't. */
function resolveTarget(deps: MemoryArchiveToolDeps, args: Record<string, unknown>): MemoryRecord | string {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (id) return deps.archive.get(id) ?? `No memory with id ${id}.`;
  const about = typeof args.about === "string" ? args.about.trim() : "";
  if (!about) return "Give the memory's id, or describe it in 'about'.";
  const hits = deps.archive.search(about, { limit: 5, includeUnconfirmed: true });
  if (!hits.length) return `No current memory matches "${about}".`;
  const [best, next] = hits;
  // Act on a description only when one match clearly leads; otherwise ask.
  if (next && next.score > best!.score * 0.6) {
    return `More than one memory could match; ask Niko which, then call again with its id:\n${hits.map((hit) => `- ${describe(hit.record)}`).join("\n")}`;
  }
  return best!.record;
}

export function buildMemoryArchiveTools(deps: MemoryArchiveToolDeps): ToolDef[] {
  return [
    {
      tool: {
        name: "memory_recall",
        description: "Search what Niko told me before, and past conversations, with dates and the source messages. Use it before saying I don't know something about Niko, and for questions like 'what did we decide about X', 'when did I say Y', 'what did we talk about last week'. Pass from/to (YYYY-MM-DD) for time questions.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to look for, in plain words." },
            from: { type: "string", description: "Optional start date, YYYY-MM-DD (Dublin)." },
            to: { type: "string", description: "Optional end date, YYYY-MM-DD (Dublin)." },
          },
          required: ["query"],
        },
      },
      run: async (args) => {
        const query = String(args.query ?? "").trim();
        if (!query) return { ok: false, text: "missing query" };
        const day = (value: unknown, end: boolean) => {
          if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
          const at = Date.parse(`${value}T${end ? "23:59:59" : "00:00:00"}Z`);
          return Number.isFinite(at) ? at : undefined;
        };
        return { ok: true, text: formatRecall(recall(deps.db, deps.archive, query, { from: day(args.from, false), to: day(args.to, true) })) };
      },
    },
    {
      tool: {
        name: "memory_list",
        description: "List everything I currently remember of one kind (fact, person, project, decision, commitment, preference, event), with no limit. Use it for 'what are all my...' questions.",
        inputSchema: {
          type: "object",
          properties: { kind: { type: "string", enum: [...MEMORY_KINDS] } },
          required: ["kind"],
        },
      },
      run: async (args) => {
        const kind = kindOf(args.kind);
        if (!kind) return { ok: false, text: "unknown kind" };
        const records = deps.archive.current({ kinds: [kind] });
        return { ok: true, text: records.length ? records.map((record) => `- ${describe(record)}`).join("\n") : `Nothing stored of kind ${kind}.` };
      },
    },
    {
      tool: {
        name: "memory_remember",
        description: "Save something Niko explicitly asked me to remember, straight away. Write it as one clear third-person sentence ('Niko's mother's name is Teo.'). If it changes something I already know on the same topic, the old version is kept as history automatically.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            kind: { type: "string", enum: [...MEMORY_KINDS] },
            topic: { type: "string", description: "A short stable label, e.g. \"mother's name\", \"gym time\"." },
            sensitive: { type: "boolean", description: "Health, money, relationships, beliefs and similar." },
            due: { type: "string", description: "For a commitment: YYYY-MM-DD or YYYY-MM-DDTHH:MM, Dublin time." },
          },
          required: ["text", "kind", "topic"],
        },
      },
      run: async (args) => {
        const kind = kindOf(args.kind) ?? "fact";
        const source = latestNikoMessage(deps);
        const due = typeof args.due === "string" ? args.due : null;
        const result = deps.archive.add({
          kind, topic: String(args.topic ?? "").trim() || String(args.text ?? "").slice(0, 60),
          text: String(args.text ?? ""), speechAct: "requested", confidence: "high", origin: "explicit",
          saidAt: source?.createdAt ?? Date.now(), sensitive: args.sensitive === true,
          sourceSessionId: deps.sessionId ?? null, sourceMessageIds: source ? [source.id] : [],
          dueAt: kind === "commitment" ? dublinDue(due) : null,
        }, "niko", deps.sessionId ?? null);
        const reply = writeReply(result, "Remembered");
        return result.ok && result.outcome !== "unchanged"
          ? { ...reply, saved: { kind: "memory" as const, id: result.record.id, title: result.record.text } }
          : reply;
      },
    },
    {
      tool: {
        name: "memory_correct",
        description: "Niko says something I remember is wrong or has changed. Replaces it with the corrected sentence; the old version is kept as dated history. Identify it by id (from memory_recall or memory_list) or describe it in 'about'.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, about: { type: "string" }, text: { type: "string", description: "The corrected memory, one clear sentence." } },
          required: ["text"],
        },
      },
      run: async (args) => {
        const target = resolveTarget(deps, args);
        if (typeof target === "string") return { ok: false, text: target };
        const source = latestNikoMessage(deps);
        const result = deps.archive.correct(target.id, {
          text: String(args.text ?? ""), saidAt: source?.createdAt ?? Date.now(), origin: "explicit",
          sourceSessionId: deps.sessionId ?? null, sourceMessageIds: source ? [source.id] : [],
        }, "niko", deps.sessionId ?? null);
        return writeReply(result, "Corrected");
      },
    },
    {
      tool: {
        name: "memory_forget",
        description: "Niko explicitly asks me to forget something about him. Erases it with every earlier version; it can't come back from old conversations. Not for 'forget about that for now', which only drops the topic. Identify it by id or describe it in 'about'.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, about: { type: "string" } },
        },
      },
      run: async (args) => {
        const target = resolveTarget(deps, args);
        if (typeof target === "string") return { ok: false, text: target };
        const result = deps.archive.forget(target.id, "niko", { sessionId: deps.sessionId ?? null });
        if (!result.ok) return { ok: false, text: `Not forgotten: ${result.message}` };
        // Read back: nothing on that topic may remain, in any version.
        return deps.archive.topicExists(target.kind, target.topic)
          ? { ok: false, text: "Forget did not complete; some versions remain. Tell Niko it failed." }
          : { ok: true, text: `Forgotten (${result.forgotten} version${result.forgotten === 1 ? "" : "s"} erased). Don't repeat what it said.` };
      },
    },
    {
      tool: {
        name: "memory_stop_carrying",
        description: "Niko says something is done, no longer relevant, or not worth bringing up. because=no_longer_true: it becomes dated history. because=dont_bring_up: still true, just left out of what I keep in mind. Neither erases it; use memory_forget only when he asks to forget.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            about: { type: "string" },
            because: { type: "string", enum: ["no_longer_true", "dont_bring_up"] },
          },
          required: ["because"],
        },
      },
      run: async (args) => {
        const target = resolveTarget(deps, args);
        if (typeof target === "string") return { ok: false, text: target };
        const source = latestNikoMessage(deps);
        const result = args.because === "dont_bring_up"
          ? deps.archive.setCarry(target.id, false, "niko", { sessionId: deps.sessionId ?? null })
          : deps.archive.end(target.id, source?.createdAt ?? Date.now(), "niko", { sessionId: deps.sessionId ?? null });
        if (!result.ok) return { ok: false, text: `Not changed: ${result.message}` };
        return { ok: true, text: args.because === "dont_bring_up"
          ? `Kept, but I'll stop bringing it up: ${describe(result.record)}`
          : `Now history, no longer current: ${describe(result.record)}` };
      },
    },
    {
      tool: {
        name: "memory_read",
        description: "Read what I currently keep in mind about Niko (the memory brief). Use when Niko asks what I know or remember about him.",
        inputSchema: { type: "object", properties: {} },
      },
      run: async () => {
        const brief = readBrief(deps.memoryDir);
        const counts = deps.archive.counts();
        const waiting = counts.unconfirmed ? ` ${counts.unconfirmed} more wait for Niko to confirm them.` : "";
        return { ok: true, text: `${brief || "Nothing remembered yet."}\n(${counts.active} current memories, ${counts.history} past versions.${waiting})` };
      },
    },
  ];
}
