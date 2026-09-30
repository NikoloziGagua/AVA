import type { Db } from "../state/db.js";
import type { ToolDef } from "./ava-mcp.js";
import {
  PROJECT_ITEM_KINDS, PROJECT_KINDS, PROJECT_STATUSES, ProjectError, addProjectItem, createProject, findProject, getProject,
  listProjects, projectBrief, removeProject, removedProjects, restoreProject, updateProject, updateProjectItem, removeProjectItem,
  type Project, type ProjectItemKind, type ProjectKind, type ProjectPatch, type ProjectSource, type ProjectStatus,
} from "../projects/store.js";
import { addLink, type Material } from "../projects/materials.js";

const text = (value: unknown) => typeof value === "string" ? value : undefined;
const failure = (error: unknown) => ({ ok: false, text: error instanceof Error ? error.message : String(error) });

function resolve(db: Db, value: unknown, removed = false): Project | null {
  const ref = text(value)?.trim();
  if (!ref) return null;
  const byId = getProject(db, ref);
  if (byId && (removed ? byId.removedAt : !byId.removedAt)) return byId;
  return findProject(db, ref, { removed });
}

const summary = (project: Project) => `${project.name} [${project.kind}, ${project.status}${project.stage ? `, ${project.stage}` : ""}] id ${project.id}`;

/**
 * Niko's projects (Business, Builds, Uni). Adding and removing act at once:
 * when he says "remove the X project", do it, then say it's gone and that
 * "bring it back" undoes it. Keep each project's steps, questions and
 * "where it stands" current as he talks about it.
 */
export function buildProjectTools(options: {
  db: Db; sessionId?: string | null; source?: Extract<ProjectSource, "chat" | "voice">;
  /** Reads a link AVA added, after the reply (see projects/extract.ts). */
  onMaterial?: (material: Material) => void;
}): ToolDef[] {
  const { db } = options;
  const source = options.source ?? "chat";
  const sessionId = options.sessionId ?? null;
  const projectArg = { type: "string", description: "The project's id or its name as Sir said it." };
  return [
    {
      tool: {
        name: "project_list",
        description: "List Sir's projects (business, build, uni) with status and stage, plus recently removed ones that can be brought back.",
        inputSchema: { type: "object", properties: {} },
      },
      run: async () => {
        const live = listProjects(db), gone = removedProjects(db, 5);
        return { ok: true, text: [
          live.length ? `Projects:\n${live.map((project) => `- ${summary(project)}`).join("\n")}` : "No projects yet.",
          gone.length ? `Recently removed (can be brought back): ${gone.map((project) => project.name).join(", ")}` : "",
        ].filter(Boolean).join("\n") };
      },
    },
    {
      tool: {
        name: "project_get",
        description: "Read one project: where it stands, next step, open steps and questions with their ids, latest progress and notes.",
        inputSchema: { type: "object", properties: { project: projectArg }, required: ["project"] },
      },
      run: async (args) => {
        const project = resolve(db, args.project);
        return project ? { ok: true, text: projectBrief(db, project) } : { ok: false, text: "No project by that name." };
      },
    },
    {
      tool: {
        name: "project_create",
        description: "Add a project the moment Sir asks. kind: business (a business idea), build (something he is building, like AVA) or uni (a university course or project).",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" }, kind: { type: "string", enum: [...PROJECT_KINDS] },
            goal: { type: "string" }, stage: { type: "string" }, summary: { type: "string", description: "Where it stands, in plain words." },
            next_step: { type: "string" },
          },
          required: ["name", "kind"],
        },
      },
      run: async (args) => {
        try {
          const project = createProject(db, {
            name: text(args.name) ?? "", kind: args.kind as ProjectKind, goal: text(args.goal), stage: text(args.stage),
            summary: text(args.summary), nextStep: text(args.next_step), source, sessionId,
          });
          return { ok: true, text: `Added the project ${summary(project)}.` };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_remove",
        description: "Remove a project from Sir's list at once when he asks. Its notes stay in Notes. project_restore brings it back.",
        inputSchema: { type: "object", properties: { project: projectArg }, required: ["project"] },
      },
      run: async (args) => {
        const project = resolve(db, args.project);
        if (!project) return { ok: false, text: "No live project by that name." };
        try { removeProject(db, project.id); return { ok: true, text: `Removed ${project.name}. Say "bring it back" to undo.` }; }
        catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_restore",
        description: "Bring back a project Sir removed.",
        inputSchema: { type: "object", properties: { project: projectArg }, required: ["project"] },
      },
      run: async (args) => {
        const project = resolve(db, args.project, true);
        if (!project) return { ok: false, text: "No removed project by that name." };
        try { return { ok: true, text: `Brought back ${summary(restoreProject(db, project.id))}.` }; }
        catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_update",
        description: "Change a project: rename it, move it between business/build/uni, set status (active, paused, done), stage, goal, where it stands (summary) or the next step. Only pass what changes.",
        inputSchema: {
          type: "object",
          properties: {
            project: projectArg, name: { type: "string" }, kind: { type: "string", enum: [...PROJECT_KINDS] },
            status: { type: "string", enum: [...PROJECT_STATUSES] }, stage: { type: "string" }, goal: { type: "string" },
            summary: { type: "string" }, next_step: { type: "string" },
          },
          required: ["project"],
        },
      },
      run: async (args) => {
        const project = resolve(db, args.project);
        if (!project) return { ok: false, text: "No live project by that name." };
        const patch: ProjectPatch = {};
        if (text(args.name) !== undefined) patch.name = text(args.name);
        if (text(args.kind) !== undefined) patch.kind = args.kind as ProjectKind;
        if (text(args.status) !== undefined) patch.status = args.status as ProjectStatus;
        for (const [arg, key] of [["stage", "stage"], ["goal", "goal"], ["summary", "summary"], ["next_step", "nextStep"]] as const) {
          if (text(args[arg]) !== undefined) patch[key] = text(args[arg]);
        }
        try { return { ok: true, text: `Updated ${summary(updateProject(db, project.id, patch, { source, sessionId }))}.` }; }
        catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_add",
        description: "Add to a project: a step (something to do), a question (still open), or a log line (progress Sir reported, a decision, a fact he found).",
        inputSchema: {
          type: "object",
          properties: { project: projectArg, kind: { type: "string", enum: [...PROJECT_ITEM_KINDS] }, text: { type: "string" } },
          required: ["project", "kind", "text"],
        },
      },
      run: async (args) => {
        const project = resolve(db, args.project);
        if (!project) return { ok: false, text: "No live project by that name." };
        try {
          const item = addProjectItem(db, project.id, { kind: args.kind as ProjectItemKind, text: text(args.text) ?? "", source, sessionId });
          return { ok: true, text: `Added to ${project.name}: ${item.text} (${item.id}).` };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_add_link",
        description: "Attach a web link Sir shared to a project's materials. AVA then reads the page and keeps what matters for the project.",
        inputSchema: { type: "object", properties: { project: projectArg, url: { type: "string" } }, required: ["project", "url"] },
      },
      run: async (args) => {
        const project = resolve(db, args.project);
        if (!project) return { ok: false, text: "No live project by that name." };
        try {
          const material = addLink(db, project.id, { url: text(args.url) ?? "", source });
          options.onMaterial?.(material);
          return { ok: true, text: `Added the link to ${project.name}'s materials. I'm reading it now; what matters will show there shortly.` };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "project_item",
        description: "Tick a project step done or not done, reword a step or question, mark a question answered (done), or delete a step or question. Use the item id from project_get.",
        inputSchema: {
          type: "object",
          properties: { item_id: { type: "string" }, done: { type: "boolean" }, text: { type: "string" }, delete: { type: "boolean" } },
          required: ["item_id"],
        },
      },
      run: async (args) => {
        const id = text(args.item_id) ?? "";
        try {
          if (args.delete === true) { removeProjectItem(db, id); return { ok: true, text: "Deleted." }; }
          const item = updateProjectItem(db, id, { done: typeof args.done === "boolean" ? args.done : undefined, text: text(args.text) }, { source, sessionId });
          return { ok: true, text: `${item.doneAt ? "Done" : "Open"}: ${item.text}` };
        } catch (error) { return error instanceof ProjectError ? failure(error) : failure(error); }
      },
    },
  ];
}
