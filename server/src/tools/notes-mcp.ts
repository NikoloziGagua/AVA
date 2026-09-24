import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import {
  NOTE_KINDS,
  NOTE_DOCUMENT_TYPES,
  NOTE_SECTIONS,
  NOTE_STATUSES,
  buildNoteActionPrompt,
  createNoteFolder,
  createNote,
  deleteNoteFolder,
  ensureNoteFolderPath,
  ensureNoteProject,
  getNoteFolder,
  getNote,
  listNoteFolders,
  listNoteProjects,
  listNotes,
  NoteHierarchyError,
  promoteNote,
  resolveNoteFolderPath,
  updateNoteFolder,
  updateNote,
  type NoteDocumentType,
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
    folderId: note.folderId,
    folderPath: note.folderPath.map((part) => part.name).join("/"),
    documentType: note.documentType,
    documentPosition: note.documentPosition,
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

function folderFromArgs(db: Db, args: Record<string, unknown>, createPath: boolean): string | undefined {
  const id = typeof args.folder_id === "string" ? args.folder_id.trim() : "";
  if (id) {
    if (!getNoteFolder(db, id)) throw new NoteHierarchyError("not_found", `Notes folder not found: ${id}`);
    return id;
  }
  const path = typeof args.folder_path === "string" ? args.folder_path.trim() : "";
  if (!path) return undefined;
  const folder = createPath ? ensureNoteFolderPath(db, path) : resolveNoteFolderPath(db, path);
  if (!folder) throw new NoteHierarchyError("not_found", `Notes folder not found: ${path}`);
  return folder.id;
}

export function buildNotesTools(options: {
  db: Db;
  sessionId?: string | null;
  source?: "ava_chat" | "ava_voice";
  queueSelfImprove?: (goal: string) => string | Promise<string>;
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
            folder_id: { type: "string", description: "Stable folder id. Prefer this after notes_search or notes_folders." },
            folder_path: { type: "string", description: "Folder path such as University/Agile Development. Explicit capture creates missing path segments." },
            document_type: { type: "string", enum: NOTE_DOCUMENT_TYPES, description: "Use study for lecture/topic notes with the study headings." },
            document_position: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Optional stable file position within the folder. Omit to append." },
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
          const folderId = folderFromArgs(db, args, true);
          const projectName = folderId === undefined && typeof args.project === "string" ? args.project.trim() : "";
          const project = projectName && !/^general$/i.test(projectName) ? ensureNoteProject(db, projectName).project : null;
          const note = createNote(db, {
            content,
            title: typeof args.title === "string" ? args.title : undefined,
            folderId,
            documentType: validEnum(args.document_type, NOTE_DOCUMENT_TYPES) as NoteDocumentType | undefined,
            documentPosition: Number.isSafeInteger(args.document_position) ? Number(args.document_position) : undefined,
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
          return {
            ok: true,
            text: `Saved to ${note.collection ?? "General"} Notes.\n${JSON.stringify(noteSummary(note))}`,
            saved: { kind: note.kind === "idea" ? "idea" : "note", id: note.id, title: note.title || content },
          };
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
            folder_id: { type: "string" },
            folder_path: { type: "string", description: "Exact folder path to search." },
            include_subfolders: { type: "boolean" },
            document_type: { type: "string", enum: NOTE_DOCUMENT_TYPES },
            document_position: { type: "integer", minimum: 0, maximum: 1_000_000, description: "Versioned file reorder within the folder." },
            kind: { type: "string", enum: NOTE_KINDS },
            section: { type: "string", enum: NOTE_SECTIONS },
            stage: { type: "string", enum: NOTE_STATUSES },
            pinned: { type: "boolean" },
          },
        },
      },
      run: async (args) => {
        try {
          const folderId = folderFromArgs(db, args, false);
          const projectName = folderId === undefined && typeof args.project === "string" ? args.project.trim() : "";
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
            folderId,
            subtree: folderId !== undefined && args.include_subfolders === true,
            documentType: validEnum(args.document_type, NOTE_DOCUMENT_TYPES) as NoteDocumentType | undefined,
            kind: validEnum(args.kind, NOTE_KINDS) as NoteKind | undefined,
            section: validEnum(args.section, NOTE_SECTIONS) as NoteSection | undefined,
            status: validEnum(args.stage, NOTE_STATUSES) as NoteStatus | undefined,
            pinned: typeof args.pinned === "boolean" ? args.pinned : undefined,
            limit: 40,
          });
          return {
            ok: true,
            text: found.length
              ? JSON.stringify({ count: found.length, notes: found.map(noteSummary), folders: listNoteFolders(db) })
              : "No matching notes.",
          };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
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
            folder_id: { type: "string" },
            folder_path: { type: "string", description: "Existing destination folder path." },
            document_type: { type: "string", enum: NOTE_DOCUMENT_TYPES },
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
        try {
          const folderId = folderFromArgs(db, args, false);
          const projectName = folderId === undefined && typeof args.project === "string" ? args.project.trim() : undefined;
          let projectId: string | null | undefined;
          if (projectName !== undefined) {
            projectId = /^general$/i.test(projectName) || !projectName
              ? null
              : ensureNoteProject(db, projectName).project.id;
          }
          const result = updateNote(db, id, expectedVersion, {
            ...(typeof args.title === "string" ? { title: args.title } : {}),
            ...(typeof args.content === "string" ? { content: args.content } : {}),
            ...(folderId !== undefined ? { folderId } : {}),
            ...(projectId !== undefined ? { projectId } : {}),
            ...(validEnum(args.document_type, NOTE_DOCUMENT_TYPES) ? { documentType: args.document_type as NoteDocumentType } : {}),
            ...(Number.isSafeInteger(args.document_position) ? { documentPosition: Number(args.document_position) } : {}),
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
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    {
      tool: {
        name: "notes_folders",
        description:
          "List or explicitly organise Sir's Notes folder hierarchy. Actions: list, create, rename, move, delete. " +
          "Read/list first; rename, move and delete require the current expected_version. Delete works only for an empty folder.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "create", "rename", "move", "delete"] },
            folder_id: { type: "string" },
            folder_path: { type: "string", description: "Existing target path; for create this may be the complete path to create." },
            parent_folder_id: { type: "string" },
            parent_folder_path: { type: "string", description: "Existing parent. Omit during move to make the target top-level." },
            name: { type: "string" },
            description: { type: "string" },
            expected_version: { type: "integer" },
          },
          required: ["action"],
        },
      },
      run: async (args) => {
        const action = String(args.action ?? "");
        try {
          if (action === "list") {
            return { ok: true, text: JSON.stringify({ folders: listNoteFolders(db).slice(0, 250) }) };
          }
          if (action === "create") {
            const fullPath = typeof args.folder_path === "string" ? args.folder_path.trim() : "";
            let folder;
            if (fullPath) folder = ensureNoteFolderPath(db, fullPath);
            else {
              const name = typeof args.name === "string" ? args.name : "";
              const parentId = typeof args.parent_folder_id === "string" && args.parent_folder_id.trim()
                ? args.parent_folder_id.trim()
                : typeof args.parent_folder_path === "string" && args.parent_folder_path.trim()
                  ? resolveNoteFolderPath(db, args.parent_folder_path.trim())?.id
                  : null;
              if (typeof args.parent_folder_path === "string" && args.parent_folder_path.trim() && !parentId) {
                return { ok: false, text: `Parent folder not found: ${args.parent_folder_path}` };
              }
              folder = createNoteFolder(db, {
                parentId,
                name,
                description: typeof args.description === "string" ? args.description : undefined,
              });
            }
            return { ok: true, text: `Notes folder ready.\n${JSON.stringify(folder)}` };
          }
          const target = typeof args.folder_id === "string" && args.folder_id.trim()
            ? getNoteFolder(db, args.folder_id.trim())
            : typeof args.folder_path === "string"
              ? resolveNoteFolderPath(db, args.folder_path)
              : null;
          if (!target) return { ok: false, text: "Notes folder not found." };
          const expectedVersion = Number(args.expected_version);
          if (!Number.isInteger(expectedVersion)) return { ok: false, text: "expected_version is required" };
          if (action === "delete") {
            const result = deleteNoteFolder(db, target.id, expectedVersion);
            if (!result.ok) return {
              ok: false,
              text: result.reason === "version_conflict"
                ? `This folder changed. List again and use version ${result.folder?.version}.`
                : "Notes folder not found.",
            };
            return { ok: true, text: `Deleted empty Notes folder ${target.path}.` };
          }
          if (action === "rename") {
            if (typeof args.name !== "string") return { ok: false, text: "name is required" };
            const result = updateNoteFolder(db, target.id, expectedVersion, {
              name: args.name,
              ...(typeof args.description === "string" ? { description: args.description } : {}),
            });
            if (!result.ok) return {
              ok: false,
              text: result.reason === "version_conflict"
                ? `This folder changed. List again and use version ${result.folder?.version}.`
                : "Notes folder not found.",
            };
            return { ok: true, text: `Renamed Notes folder.\n${JSON.stringify(result.folder)}` };
          }
          if (action === "move") {
            let parentId: string | null = null;
            if (typeof args.parent_folder_id === "string" && args.parent_folder_id.trim()) {
              parentId = args.parent_folder_id.trim();
              if (!getNoteFolder(db, parentId)) return { ok: false, text: "Destination folder not found." };
            } else if (typeof args.parent_folder_path === "string" && args.parent_folder_path.trim()) {
              parentId = resolveNoteFolderPath(db, args.parent_folder_path.trim())?.id ?? null;
              if (!parentId) return { ok: false, text: "Destination folder not found." };
            }
            const result = updateNoteFolder(db, target.id, expectedVersion, { parentId });
            if (!result.ok) return {
              ok: false,
              text: result.reason === "version_conflict"
                ? `This folder changed. List again and use version ${result.folder?.version}.`
                : "Notes folder not found.",
            };
            return { ok: true, text: `Moved Notes folder.\n${JSON.stringify(result.folder)}` };
          }
          return { ok: false, text: "action must be list, create, rename, move or delete" };
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) };
        }
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
          try { promotionId = await options.queueSelfImprove(buildNoteActionPrompt(current)); }
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
