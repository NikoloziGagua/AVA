import type { ToolDef } from "./ava-mcp.js";
import { memoryPaths } from "../memory/paths.js";
import { writeFile, appendLine, readFile as readMemFile } from "../memory/store.js";
import { applyRefresh, applySupersede, serializeObservation, type Confidence } from "../memory/observations.js";
import { forgetLast, forgetMatch, forgetProject } from "../memory/forget.js";
import { rememberObservation } from "../memory/remember.js";
import { ensureProjectIndexed } from "../memory/project-index.js";
import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { MemoryIndexService } from "../memory-index/store.js";
import { MEMORY_INDEX_KINDS, MEMORY_PRIVACY_LEVELS, type MemoryIndexKind, type MemoryPrivacyLevel } from "../memory-index/types.js";

export type MemoryToolDeps = {
  memoryDir: string;
  db?: Db;
  index?: MemoryIndexService;
  sessionId?: string | null;
};

function buildMemoryRead(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_read",
      description:
        "Read durable memory. Use when Sir asks 'what do you remember about…' rather than reciting from the system prompt.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["all", "preferences", "observations", "project"] },
          project: { type: "string", description: "Required when file=project; slug." },
        },
        required: ["file"],
      },
    },
    run: async (args) => {
      const file = String(args.file ?? "");
      const p = memoryPaths(deps.memoryDir);
      if (file === "preferences") return { ok: true, text: readMemFile(p.preferences) };
      if (file === "observations") return { ok: true, text: readMemFile(p.observations) };
      if (file === "project") {
        const slug = String(args.project ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        try {
          return { ok: true, text: readMemFile(p.projectFile(slug)) };
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      }
      if (file === "all") {
        const parts = [
          readMemFile(p.memoryIndex),
          readMemFile(p.preferences),
          readMemFile(p.observations),
        ].filter((s) => s.length > 0);
        return { ok: true, text: parts.join("\n---\n") };
      }
      return { ok: false, text: `unknown file: ${file}` };
    },
  };
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(["low", "medium", "high"]);

function buildMemoryRemember(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_remember",
      description:
        "Write durable memory. Default file=observations. Use refresh=<substring> to bump an existing observation's confidence/date instead of duplicating. Use supersedes=<substring> to mark a contradicted observation and append the new one.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["preferences", "observations", "project"] },
          project: { type: "string", description: "Required when file=project; slug." },
          text: { type: "string" },
          category: { type: "string", description: "Required for observations." },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          refresh: { type: "string", description: "Substring of an existing observation to bump." },
          supersedes: { type: "string", description: "Substring of an existing observation to mark superseded." },
          today: { type: "string", description: "ISO yyyy-mm-dd; injectable for tests." },
        },
      },
    },
    run: async (args) => {
      const p = memoryPaths(deps.memoryDir);
      const today = String(args.today ?? isoToday());
      const file = String(args.file ?? "observations");

      if (typeof args.refresh === "string" && args.refresh.length > 0) {
        if (file !== "observations") {
          return { ok: false, text: "refresh is only valid for file=observations" };
        }
        if (typeof args.supersedes === "string" && args.supersedes.length > 0) {
          return { ok: false, text: "refresh and supersedes are mutually exclusive" };
        }
        const r = applyRefresh(readMemFile(p.observations),
          { match: args.refresh, today });
        if (!r.changed) return { ok: false, text: "refresh: no matching observation" };
        writeFile(p.observations, r.content);
        return { ok: true, text: "refreshed" };
      }

      if (file === "preferences") {
        const text = String(args.text ?? "").trim();
        if (!text) return { ok: false, text: "missing text" };
        appendLine(p.preferences, text);
        return { ok: true, text: "remembered (preferences)" };
      }

      if (file === "project") {
        const slug = String(args.project ?? "").trim();
        const text = String(args.text ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        if (!text) return { ok: false, text: "missing text" };
        try {
          appendLine(p.projectFile(slug), text);
          ensureProjectIndexed(deps.memoryDir, slug);
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
        return { ok: true, text: `remembered (project:${slug})` };
      }

      // file === "observations"
      const text = String(args.text ?? "").trim();
      const category = String(args.category ?? "context").trim();
      const rawConf = String(args.confidence ?? "low");
      if (!VALID_CONFIDENCE.has(rawConf)) {
        return { ok: false, text: `invalid confidence: ${rawConf}` };
      }
      const confidence = rawConf as Confidence;
      if (!text) return { ok: false, text: "missing text" };

      if (typeof args.supersedes === "string" && args.supersedes.length > 0) {
        const r = applySupersede(readMemFile(p.observations),
          { match: args.supersedes, today });
        if (r.changed) writeFile(p.observations, r.content);
      }

      rememberObservation({
        memoryDir: deps.memoryDir, category, confidence, text, today,
      });
      return { ok: true, text: "remembered (observation)" };
    },
  };
}

function buildMemoryForget(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_forget",
      description:
        "Drop a memory entry. Use mode=last after Sir says 'forget that' shortly after a remember; mode=match for 'forget what I said about X' (returns ambiguous with candidates if more than one matches); mode=project for 'forget everything about project <slug>'.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["last", "match", "project"] },
          target: { type: "string", description: "Required for mode=match (substring) and mode=project (slug)." },
        },
        required: ["mode"],
      },
    },
    run: async (args) => {
      const mode = String(args.mode ?? "");
      const p = memoryPaths(deps.memoryDir);

      if (mode === "last") {
        const r = forgetLast({ paths: p });
        if (!r.dropped) return { ok: false, text: "no observations to forget" };
        return { ok: true, text: `dropped: ${r.dropped}` };
      }
      if (mode === "match") {
        const target = String(args.target ?? "").trim();
        if (!target) return { ok: false, text: "missing target" };
        const r = forgetMatch({ paths: p, target });
        if (r.status === "not_found") return { ok: false, text: "not found" };
        if (r.status === "ambiguous")
          return { ok: false, text: `ambiguous; candidates:\n${r.candidates.join("\n")}` };
        return { ok: true, text: `dropped: ${r.line}` };
      }
      if (mode === "project") {
        const slug = String(args.target ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        try {
          const r = forgetProject({ paths: p, slug });
          return { ok: true, text: `dropped project ${slug}; file removed: ${r.removedFile}` };
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      }
      return { ok: false, text: `unknown mode: ${mode}` };
    },
  };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function governanceRequestKey(
  runId: string,
  action: string,
  target: string,
  expectedVersion: number,
  supplied: unknown,
): string {
  const explicit = typeof supplied === "string" ? supplied.trim() : "";
  return explicit || `${runId}:memory:${action}:${target}:${expectedVersion}`;
}

function governanceToolResult(result: ReturnType<MemoryIndexService["setPinned"]>): { ok: boolean; text: string } {
  if (!result.ok) {
    return {
      ok: false,
      text: JSON.stringify({
        error: result.reason,
        currentVersion: result.currentVersion,
        message: result.message,
        instruction: result.reason === "version_conflict" ? "Search again and use the current governance version." : undefined,
      }),
    };
  }
  return {
    ok: true,
    text: JSON.stringify({
      event: result.event,
      id: result.result.entry.id,
      threadId: result.result.lineage.threadId,
      governance: result.result.governance,
      source: result.result.source,
      note: "The governance event is immutable. The original checkpoint and conversation source were not rewritten.",
    }),
  };
}

export function buildMemoryIndexTools(deps: MemoryToolDeps): ToolDef[] {
  if (!deps.db || !deps.index || !deps.sessionId) return [];
  const db = deps.db;
  const index = deps.index;
  const sessionId = deps.sessionId;
  return [
    {
      tool: {
        name: "memory_index_capture",
        description:
          "Index an important research result or developed idea from this conversation when Sir explicitly asks AVA to remember/index it. Store a concise summary and source range, not the transcript. Use start_marker to select the first relevant message, or recent_messages for a bounded recent segment.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: MEMORY_INDEX_KINDS },
            title: { type: "string", description: "Short, specific memory title." },
            summary: { type: "string", description: "Useful compact summary of the developed research or idea." },
            conclusions: { type: "array", items: { type: "string" } },
            open_questions: { type: "array", items: { type: "string" } },
            next_steps: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            project: { type: "string", description: "Required when privacy_level=project." },
            privacy_level: { type: "string", enum: MEMORY_PRIVACY_LEVELS },
            start_marker: { type: "string", description: "A distinctive phrase present in the first relevant conversation message." },
            start_message_id: { type: "integer", description: "Optional exact source boundary when already known." },
            through_message_id: { type: "integer", description: "Optional exact final source boundary when already known." },
            recent_messages: { type: "integer", minimum: 1, maximum: 40, description: "Fallback segment size; defaults to 10." },
          },
          required: ["kind", "title", "summary"],
        },
      },
      run: async (args) => {
        const all = listMessages(db, sessionId);
        if (!all.length) return { ok: false, text: "This conversation has no persisted messages to index." };
        const explicitThrough = Number(args.through_message_id);
        const through = Number.isInteger(explicitThrough) && explicitThrough > 0
          ? all.find((message) => message.id === explicitThrough)
          : all.at(-1);
        if (!through) return { ok: false, text: "The requested final source message was not found." };
        const eligible = all.filter((message) => message.id <= through.id);
        let from = null as typeof eligible[number] | null;
        const explicitFrom = Number(args.start_message_id);
        if (Number.isInteger(explicitFrom) && explicitFrom > 0) {
          from = eligible.find((message) => message.id === explicitFrom) ?? null;
        } else if (typeof args.start_marker === "string" && args.start_marker.trim()) {
          const marker = args.start_marker.trim().toLocaleLowerCase();
          // `start_marker` names the FIRST relevant source message. The user's
          // capture instruction often repeats that phrase verbatim (for example,
          // "index the discussion beginning X"). Searching backward therefore
          // selected the capture command itself and produced a hash-valid range
          // that omitted the actual discussion. Search chronologically so the
          // bounded source contains every later refinement through `through`.
          for (let indexAt = 0; indexAt < eligible.length; indexAt += 1) {
            if (eligible[indexAt]!.content.toLocaleLowerCase().includes(marker)) {
              from = eligible[indexAt]!;
              break;
            }
          }
          if (!from) return { ok: false, text: "The start_marker was not found in this conversation. Use a phrase copied from the first relevant message or recent_messages." };
        } else {
          const countRaw = Number(args.recent_messages ?? 10);
          const count = Number.isInteger(countRaw) ? Math.max(1, Math.min(40, countRaw)) : 10;
          from = eligible[Math.max(0, eligible.length - count)] ?? null;
        }
        if (!from || from.id > through.id) return { ok: false, text: "The selected conversation range is invalid." };
        const kind = typeof args.kind === "string" && (MEMORY_INDEX_KINDS as readonly string[]).includes(args.kind)
          ? args.kind as MemoryIndexKind
          : null;
        const privacyLevel = typeof args.privacy_level === "string" && (MEMORY_PRIVACY_LEVELS as readonly string[]).includes(args.privacy_level)
          ? args.privacy_level as MemoryPrivacyLevel
          : "personal";
        if (!kind) return { ok: false, text: "kind must be research, idea or remembered" };
        try {
          const captured = await index.capture({
            sessionId,
            fromMessageId: from.id,
            throughMessageId: through.id,
            kind,
            title: String(args.title ?? ""),
            summary: String(args.summary ?? ""),
            conclusions: stringList(args.conclusions),
            openQuestions: stringList(args.open_questions),
            nextSteps: stringList(args.next_steps),
            tags: stringList(args.tags),
            project: typeof args.project === "string" ? args.project : null,
            privacyLevel,
          });
          const result = captured.result;
          return {
            ok: true,
            text: JSON.stringify({
              created: captured.created,
              id: result.entry.id,
              version: result.entry.version,
              title: result.entry.title,
              embedding: result.entry.embeddingStatus,
              source: result.source,
              note: captured.created
                ? "Indexed once with a verified conversation source."
                : "Reused the existing entry for this exact source range; no duplicate was created.",
            }),
          };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      tool: {
        name: "memory_index_search",
        description:
          "Search AVA's compact cross-session index for prior research, developed ideas, decisions and remembered discussions. Use this before saying AVA cannot recall prior work. Related idea refinements share lineage; normally prefer lineage.isLatest=true, but preserve older checkpoints when Sir asks how the idea evolved. Only rely on results whose source status is verified; explain the match reason and any fallback notice.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            project: { type: "string", description: "Optional explicit project boundary. Other projects are excluded." },
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["query"],
        },
      },
      run: async (args) => {
        try {
          const found = await index.search(String(args.query ?? ""), {
            project: typeof args.project === "string" ? args.project : null,
            limit: Number.isInteger(Number(args.limit)) ? Number(args.limit) : undefined,
          });
          return {
            ok: true,
            text: JSON.stringify({
              ...found,
              instruction: "Use only usable=true results. Group results with the same lineage.threadId and normally use the latest checkpoint; older checkpoints are immutable history. A match locates evidence; it does not replace the verified source.",
            }),
          };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      tool: {
        name: "memory_index_open",
        description:
          "Open the authoritative conversation range behind one source-verified index result. Search first, then use its exact ID and matching project boundary. Content is sanitized and bounded; do not use messages when usable=false.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            project: { type: "string", description: "Required for a project-scoped result." },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "").trim();
        if (!id) return { ok: false, text: "id is required" };
        const source = index.readSource(id, {
          project: typeof args.project === "string" ? args.project : null,
        });
        if (!source) return { ok: false, text: "Indexed memory not found in this privacy scope." };
        return {
          ok: source.result.usable,
          text: JSON.stringify({
            ...source,
            instruction: source.result.usable
              ? "Answer from these authoritative sanitized source messages, using the compact summary only as a locator. State when the returned range is truncated."
              : "Do not answer from this memory because its source is not verified.",
          }),
        };
      },
    },
    {
      tool: {
        name: "memory_index_forget",
        description:
          "Forget one semantic-index entry by exact ID and current version. Search first when Sir describes the memory rather than naming it. Forget removes it from lexical and semantic retrieval without deleting the original conversation.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            expected_version: { type: "integer" },
          },
          required: ["id", "expected_version"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "");
        const expectedVersion = Number(args.expected_version);
        if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, text: "id and expected_version are required" };
        }
        const forgotten = index.forget(id, expectedVersion);
        if (!forgotten.ok) {
          return {
            ok: false,
            text: forgotten.reason === "version_conflict"
              ? `That memory changed. Search again and use version ${forgotten.currentVersion}.`
              : "Memory index entry not found.",
          };
        }
        return { ok: true, text: `Forgot semantic memory ${id}. Its embedding was removed; the original conversation was not deleted.` };
      },
    },
    {
      tool: {
        name: "memory_index_correct",
        description:
          "Correct the compact current view of one exact indexed memory only after Sir explicitly asks. This appends an immutable user-governance event; it never rewrites the original checkpoint or claims the correction came from its source conversation. Search first and use the exact entry/thread governance version.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            expected_version: { type: "integer" },
            reason: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            conclusions: { type: "array", items: { type: "string" } },
            open_questions: { type: "array", items: { type: "string" } },
            next_steps: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            project: { type: "string" },
            request_id: { type: "string", description: "Optional stable retry key." },
          },
          required: ["id", "expected_version", "reason"],
        },
      },
      run: async (args, context) => {
        const id = String(args.id ?? "").trim();
        const expectedVersion = Number(args.expected_version);
        const project = typeof args.project === "string" ? args.project : null;
        const current = index.get(id, { project });
        if (!current) return { ok: false, text: "Indexed memory not found in this privacy scope." };
        if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, text: "id and expected_version are required" };
        const result = await index.correct({
          threadId: current.lineage.threadId,
          entryId: id,
          expectedVersion,
          actor: "ava",
          reason: String(args.reason ?? ""),
          requestKey: governanceRequestKey(context.runId, "correct", id, expectedVersion, args.request_id),
          project,
          correction: {
            ...(typeof args.title === "string" ? { title: args.title } : {}),
            ...(typeof args.summary === "string" ? { summary: args.summary } : {}),
            ...(stringList(args.conclusions) !== undefined ? { conclusions: stringList(args.conclusions)! } : {}),
            ...(stringList(args.open_questions) !== undefined ? { openQuestions: stringList(args.open_questions)! } : {}),
            ...(stringList(args.next_steps) !== undefined ? { nextSteps: stringList(args.next_steps)! } : {}),
            ...(stringList(args.tags) !== undefined ? { tags: stringList(args.tags)! } : {}),
          },
        });
        return governanceToolResult(result);
      },
    },
    {
      tool: {
        name: "memory_index_pin",
        description:
          "Pin or unpin one exact current memory thread after Sir asks. Pinning is a versioned priority hint among relevant matches; it never makes an unrelated memory relevant.",
        inputSchema: {
          type: "object",
          properties: {
            thread_id: { type: "string" },
            expected_version: { type: "integer" },
            pinned: { type: "boolean" },
            reason: { type: "string" },
            project: { type: "string" },
            request_id: { type: "string" },
          },
          required: ["thread_id", "expected_version", "pinned", "reason"],
        },
      },
      run: async (args, context) => {
        const threadId = String(args.thread_id ?? "").trim();
        const expectedVersion = Number(args.expected_version);
        if (!threadId || !Number.isInteger(expectedVersion) || typeof args.pinned !== "boolean") {
          return { ok: false, text: "thread_id, expected_version and pinned are required" };
        }
        return governanceToolResult(index.setPinned({
          threadId,
          expectedVersion,
          pinned: args.pinned,
          actor: "ava",
          reason: String(args.reason ?? ""),
          requestKey: governanceRequestKey(context.runId, args.pinned ? "pin" : "unpin", threadId, expectedVersion, args.request_id),
          project: typeof args.project === "string" ? args.project : null,
        }));
      },
    },
    {
      tool: {
        name: "memory_index_supersede",
        description:
          "Mark one obsolete memory thread as replaced by another exact current source-verified thread after Sir explicitly decides. Both threads must share the same privacy scope; history remains visible.",
        inputSchema: {
          type: "object",
          properties: {
            thread_id: { type: "string" },
            expected_version: { type: "integer" },
            replacement_thread_id: { type: "string" },
            replacement_expected_version: { type: "integer" },
            reason: { type: "string" },
            project: { type: "string" },
            request_id: { type: "string" },
          },
          required: ["thread_id", "expected_version", "replacement_thread_id", "replacement_expected_version", "reason"],
        },
      },
      run: async (args, context) => {
        const threadId = String(args.thread_id ?? "").trim();
        const replacementThreadId = String(args.replacement_thread_id ?? "").trim();
        const expectedVersion = Number(args.expected_version);
        const replacementExpectedVersion = Number(args.replacement_expected_version);
        if (!threadId || !replacementThreadId || !Number.isInteger(expectedVersion) || !Number.isInteger(replacementExpectedVersion)) {
          return { ok: false, text: "Both thread IDs and governance versions are required" };
        }
        return governanceToolResult(index.supersede({
          threadId, expectedVersion, replacementThreadId, replacementExpectedVersion,
          actor: "ava", reason: String(args.reason ?? ""),
          requestKey: governanceRequestKey(context.runId, "supersede", threadId, expectedVersion, args.request_id),
          project: typeof args.project === "string" ? args.project : null,
        }));
      },
    },
    {
      tool: {
        name: "memory_index_conflict",
        description:
          "Open or resolve an explicit contradiction between two exact memory threads after Sir decides. Unresolved conflicts suppress both memories from automatic use. Resolving keeps thread_id as the winner and supersedes other_thread_id; no content is silently merged.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["open", "resolve"] },
            thread_id: { type: "string", description: "For resolve, this is the winning thread." },
            expected_version: { type: "integer" },
            other_thread_id: { type: "string", description: "For resolve, this is the losing thread." },
            other_expected_version: { type: "integer" },
            reason: { type: "string" },
            project: { type: "string" },
            request_id: { type: "string" },
          },
          required: ["mode", "thread_id", "expected_version", "other_thread_id", "other_expected_version", "reason"],
        },
      },
      run: async (args, context) => {
        const mode = args.mode === "resolve" ? "resolve" : "open";
        const threadId = String(args.thread_id ?? "").trim();
        const otherThreadId = String(args.other_thread_id ?? "").trim();
        const expectedVersion = Number(args.expected_version);
        const otherExpectedVersion = Number(args.other_expected_version);
        if (!threadId || !otherThreadId || !Number.isInteger(expectedVersion) || !Number.isInteger(otherExpectedVersion)) {
          return { ok: false, text: "Both thread IDs and governance versions are required" };
        }
        const common = {
          threadId, expectedVersion, actor: "ava" as const, reason: String(args.reason ?? ""),
          requestKey: governanceRequestKey(context.runId, `conflict-${mode}`, threadId, expectedVersion, args.request_id),
          project: typeof args.project === "string" ? args.project : null,
        };
        return governanceToolResult(mode === "resolve"
          ? index.resolveConflict({ ...common, losingThreadId: otherThreadId, losingExpectedVersion: otherExpectedVersion })
          : index.openConflict({ ...common, otherThreadId, otherExpectedVersion }));
      },
    },
  ];
}

export function buildMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  return [
    buildMemoryRead(deps),
    buildMemoryRemember(deps),
    buildMemoryForget(deps),
    ...buildMemoryIndexTools(deps),
  ];
}
