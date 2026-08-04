import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import {
  NOTE_KINDS,
  NOTE_SECTIONS,
  NOTE_STATUSES,
  buildNoteActionPrompt,
  createNote,
  ensureNoteProject,
  getNote,
  listNoteProjects,
  listNotes,
  promoteNote,
  updateNote,
  type NoteKind,
  type NoteLink,
  type NoteSection,
  type NoteStatus,
} from "../state/notes.js";
import type { ToolDef } from "./ava-mcp.js";

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
}

function links(value: unknown): NoteLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { label?: unknown; url?: unknown };
    if (typeof candidate.url !== "string") return [];
    return [{ label: typeof candidate.label === "string" ? candidate.label : "", url: candidate.url }];
  });
}

function validEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

function noteSummary(note: ReturnType<typeof getNote> extends infer _T ? NonNullable<ReturnType<typeof getNote>> : never) {
  return {
    id: note.id,
    version: note.version,
    title: note.title,
    project: note.collection ?? "General",
    section: note.section,
    stage: note.status,
    kind: note.kind,
    pinned: note.pinned,
    tags: note.tags,
    content: note.content.slice(0, 700),
    links: note.links,
    promotion: note.promotion,
    updatedAt: note.updatedAt,
  };
}

export function buildNotesTools(options: {
  db: Db;
  sessionId?: string | null;
  source?: "ava_chat" | "ava_voice";
  queueSelfImprove?: (goal: string) => string;
}): ToolDef[] {
  const { db } = options;
  return [
    {
      tool: {
        name: "notes_capture",
        description:
          "Save something in Sir's visible Notes workspace. Use this whenever Sir says put/save/add/capture this in Notes. Choose General unless he names a project; choose decisions/documentation/priorities when the content clearly belongs there.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The complete useful note context, not merely a paraphrased title." },
            title: { type: "string" },
            project: { type: "string", description: "Optional project-space name. It is created if missing." },
            kind: { type: "string", enum: NOTE_KINDS },
            section: { type: "string", enum: NOTE_SECTIONS },
            stage: { type: "string", enum: NOTE_STATUSES },
            tags: { type: "array", items: { type: "string" } },
            links: {
              type: "array",
              items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } }, required: ["url"] },
            },
            pinned: { type: "boolean" },
          },
          required: ["content"],
        },
      },
      run: async (args) => {
        const content = String(args.content ?? "").trim();
        if (!content) return { ok: false, text: "note content is required" };
        try {
          const projectName = typeof args.project === "string" ? args.project.trim() : "";
          const project = projectName && !/^general$/i.test(projectName) ? ensureNoteProject(db, projectName).project : null;
          const note = createNote(db, {
            content,
            title: typeof args.title === "string" ? args.title : undefined,
            projectId: project?.id,
            kind: validEnum(args.kind, NOTE_KINDS),
            section: validEnum(args.section, NOTE_SECTIONS),
            status: validEnum(args.stage, NOTE_STATUSES),
            tags: stringArray(args.tags),
            links: links(args.links),
            pinned: args.pinned === true,
            source: options.source ?? "ava_chat",
            sourceSessionId: options.sessionId ?? null,
          });
          return { ok: true, text: `Saved to ${note.collection ?? "General"} Notes.\n${JSON.stringify(noteSummary(note))}` };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      tool: {
        name: "notes_search",
        description: "Search and inspect Sir's structured Notes, project spaces and Kanban stages before answering questions about saved ideas, requirements, decisions or documentation.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            project: { type: "string", description: "Project name, or General." },
            kind: { type: "string", enum: NOTE_KINDS },
            section: { type: "string", enum: NOTE_SECTIONS },
            stage: { type: "string", enum: NOTE_STATUSES },
            pinned: { type: "boolean" },
          },
        },
      },
      run: async (args) => {
        const projectName = typeof args.project === "string" ? args.project.trim() : "";
        let projectId: string | null | undefined;
        if (/^general$/i.test(projectName)) projectId = null;
        else if (projectName) {
          const project = listNoteProjects(db).find((entry) => entry.name.toLocaleLowerCase() === projectName.toLocaleLowerCase());
          if (!project) return { ok: false, text: `Notes project not found: ${projectName}` };
          projectId = project.id;
        }
        const found = listNotes(db, {
          q: typeof args.query === "string" ? args.query : undefined,
          projectId,
          kind: validEnum(args.kind, NOTE_KINDS) as NoteKind | undefined,
          section: validEnum(args.section, NOTE_SECTIONS) as NoteSection | undefined,
          status: validEnum(args.stage, NOTE_STATUSES) as NoteStatus | undefined,
          pinned: typeof args.pinned === "boolean" ? args.pinned : undefined,
          limit: 40,
        });
        return {
          ok: true,
          text: found.length
            ? JSON.stringify({ count: found.length, notes: found.map(noteSummary), projects: listNoteProjects(db) })
            : "No matching notes.",
        };
      },
    },
    {
      tool: {
        name: "notes_update",
        description: "Update, organise, pin or move an existing Notes item. Read/search first and pass its current version so concurrent edits cannot be overwritten.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            expected_version: { type: "integer" },
            title: { type: "string" },
            content: { type: "string" },
            project: { type: "string", description: "Project-space name, or General." },
            kind: { type: "string", enum: NOTE_KINDS },
            section: { type: "string", enum: NOTE_SECTIONS },
            stage: { type: "string", enum: NOTE_STATUSES },
            tags: { type: "array", items: { type: "string" } },
            links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } }, required: ["url"] } },
            pinned: { type: "boolean" },
          },
          required: ["id", "expected_version"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "");
        const expectedVersion = Number(args.expected_version);
        if (!id || !Number.isInteger(expectedVersion)) return { ok: false, text: "id and expected_version are required" };
        const projectName = typeof args.project === "string" ? args.project.trim() : undefined;
        let projectId: string | null | undefined;
        if (projectName !== undefined) {
          projectId = /^general$/i.test(projectName) || !projectName
            ? null
            : ensureNoteProject(db, projectName).project.id;
        }
        const result = updateNote(db, id, expectedVersion, {
          ...(typeof args.title === "string" ? { title: args.title } : {}),
          ...(typeof args.content === "string" ? { content: args.content } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(validEnum(args.kind, NOTE_KINDS) ? { kind: args.kind as NoteKind } : {}),
          ...(validEnum(args.section, NOTE_SECTIONS) ? { section: args.section as NoteSection } : {}),
          ...(validEnum(args.stage, NOTE_STATUSES) ? { status: args.stage as NoteStatus } : {}),
          ...(Array.isArray(args.tags) ? { tags: stringArray(args.tags) } : {}),
          ...(Array.isArray(args.links) ? { links: links(args.links) } : {}),
          ...(typeof args.pinned === "boolean" ? { pinned: args.pinned } : {}),
        });
        if (!result.ok) return {
          ok: false,
          text: result.reason === "version_conflict"
            ? `This note changed. Search again and use version ${result.note?.version}.`
            : "Note not found.",
        };
        return { ok: true, text: `Updated Notes item.\n${JSON.stringify(noteSummary(result.note))}` };
      },
    },
    {
      tool: {
        name: "notes_promote",
        description: "Promote a saved note into an actionable AVA task draft or an approval-gated self-improvement request. Only use self_improvement when Sir explicitly asks to turn the note into an AVA code/product improvement.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            expected_version: { type: "integer" },
            target: { type: "string", enum: ["task", "self_improvement"] },
          },
          required: ["id", "expected_version", "target"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "");
        const expectedVersion = Number(args.expected_version);
        const target = args.target === "self_improvement" ? "self_improvement" : args.target === "task" ? "task" : null;
        const current = getNote(db, id);
        if (!current) return { ok: false, text: "Note not found." };
        if (!Number.isInteger(expectedVersion) || current.version !== expectedVersion) {
          return { ok: false, text: `This note changed. Search again and use version ${current.version}.` };
        }
        if (!target) return { ok: false, text: "target must be task or self_improvement" };
        let promotionId: string;
        if (target === "self_improvement") {
          if (!options.queueSelfImprove) return { ok: false, text: "Self-improvement is unavailable." };
          try { promotionId = options.queueSelfImprove(buildNoteActionPrompt(current)); }
          catch (error) { return { ok: false, text: error instanceof Error ? error.message : String(error) }; }
        } else promotionId = `task_draft_${nanoid(10)}`;
        const result = promoteNote(db, id, expectedVersion, target, promotionId);
        if (!result.ok) return { ok: false, text: "The note changed during promotion. Search and retry." };
        return {
          ok: true,
          text: target === "task"
            ? `Task draft created (${promotionId}). Start it with this exact brief:\n\n${buildNoteActionPrompt(result.note)}`
            : `Self-improvement request ${promotionId} was queued and will require the normal plan approval.`,
        };
      },
    },
  ];
}
