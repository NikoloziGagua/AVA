import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import {
  PROJECT_KINDS, PROJECT_STATUSES, ProjectError, addProjectItem, createProject, getProject, listProjects, projectBrief,
  removeProject, removedProjects, restoreProject, updateProject, type ProjectKind, type ProjectStatus,
} from "../projects/store.js";

// The fast lane for Sir's projects. "Remove the tyre project" or "add a uni
// project for Data Science" must happen at once, not after the full agent's
// two slow rounds: a small model picks ONE action and its project from the live
// list, AVA does it directly, and the verified result is spoken. Anything else
// (a discussion, several changes, anything unclear) goes to the agent.

const ACTION_WORDS = /\b(?:add|create|start|new|make|remove|delete|drop|scrap|kill|get rid|bring\b[\w\s]{0,40}\bback|restore|undo|rename|call it|pause|resume|finish(?:ed)?|done|complete|mark|stage|next step|step|to-?do|progress|what(?:'s| is| are)|where|how(?:'s| is)|list|show|status)\b/i;

const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 2);

/** Cheap first gate: about projects, or naming one, and asking for something the lane can do. */
export function projectCandidate(request: string, names: readonly string[]): boolean {
  if (!ACTION_WORDS.test(request)) return false;
  if (/\bprojects?\b/i.test(request)) return true;
  const said = new Set(words(request).map((word) => word.replace(/^tire/, "tyre")));
  // "AVA" is also how Sir addresses her, so that project needs the word "project".
  return names.some((name) => words(name).some((word) => !["the", "and", "for", "ava"].includes(word) && said.has(word)));
}

export type ProjectPlan =
  | { action: "create"; name: string; kind: ProjectKind }
  | { action: "remove" | "restore" | "show"; projectId: string }
  | { action: "rename"; projectId: string; name: string }
  | { action: "status"; projectId: string; status: ProjectStatus }
  | { action: "stage" | "step" | "log"; projectId: string; text: string }
  | { action: "list" }
  | { action: "agent" };

const SYSTEM = `You turn ONE spoken request from Sir (Niko) into ONE action on his projects, or "agent".
Actions:
- create: add a new project. "name" = a short name in Sir's words, "kind" = business (a business idea), build (something he is building) or uni (a university course or project).
- remove: take a project off his list ("remove", "delete", "drop", "get rid of").
- restore: bring back a removed project ("bring it back", "undo that" right after a removal = the most recently removed).
- rename: "name" = the new name.
- status: "status" = active, paused or done.
- stage: "text" = the stage it is at now.
- step: add a step or to-do; "text" = the step.
- log: progress or a fact Sir reports about it; "text" = what happened.
- show: where a project stands or what its next step is.
- list: what projects he has.
- agent: discussing or brainstorming a project, several changes at once, anything else, or if unsure.
Use "project_id" exactly from the lists given. Reply with JSON only:
{"action": "...", "project_id": string or null, "name": string or null, "kind": string or null, "status": string or null, "text": string or null}`;

export function parseProjectPlan(raw: string, known: ReadonlySet<string>, removed: ReadonlySet<string>): ProjectPlan {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>; }
  catch { return { action: "agent" }; }
  const str = (key: string) => typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim().slice(0, 300) : null;
  const id = str("project_id");
  const live = id && known.has(id) ? id : null;
  switch (value.action) {
    case "create": {
      const name = str("name"), kind = str("kind");
      return name && kind && (PROJECT_KINDS as readonly string[]).includes(kind) ? { action: "create", name, kind: kind as ProjectKind } : { action: "agent" };
    }
    case "remove": case "show": return live ? { action: value.action, projectId: live } : { action: "agent" };
    case "restore": return id && removed.has(id) ? { action: "restore", projectId: id } : { action: "agent" };
    case "rename": { const name = str("name"); return live && name ? { action: "rename", projectId: live, name } : { action: "agent" }; }
    case "status": {
      const status = str("status");
      return live && status && (PROJECT_STATUSES as readonly string[]).includes(status) ? { action: "status", projectId: live, status: status as ProjectStatus } : { action: "agent" };
    }
    case "stage": case "step": case "log": {
      const text = str("text");
      return live && text ? { action: value.action, projectId: live, text } : { action: "agent" };
    }
    case "list": return { action: "list" };
    default: return { action: "agent" };
  }
}

const KIND_GROUP: Record<ProjectKind, string> = { business: "Business", build: "Builds", uni: "Uni" };

/** Carries out one plan and says what is now true, read back from the database. */
export function runProjectPlan(db: Db, plan: Exclude<ProjectPlan, { action: "agent" }>): string {
  const done = (text: string) => `Done, and checked just now: ${text}`;
  switch (plan.action) {
    case "list": {
      const live = listProjects(db);
      return live.length
        ? `Sir's projects, read just now:\n${live.map((project) => `- ${project.name} (${KIND_GROUP[project.kind]}, ${project.status}${project.stage ? `, ${project.stage}` : ""})`).join("\n")}`
        : "Sir has no projects yet.";
    }
    case "show": return `Read just now:\n${projectBrief(db, getProject(db, plan.projectId)!)}`;
    case "create": {
      const project = createProject(db, { name: plan.name, kind: plan.kind, source: "voice" });
      return done(`the project “${project.name}” is added under ${KIND_GROUP[project.kind]}, with its own notes folder.`);
    }
    case "remove": {
      const project = removeProject(db, plan.projectId);
      return done(`“${project.name}” is removed from Sir's projects. Its notes are still in Notes. He can say "bring it back" to undo.`);
    }
    case "restore": return done(`“${restoreProject(db, plan.projectId).name}” is back in Sir's projects.`);
    case "rename": {
      const before = getProject(db, plan.projectId)!.name;
      return done(`“${before}” is now called “${updateProject(db, plan.projectId, { name: plan.name }, { source: "voice" }).name}”.`);
    }
    case "status": {
      const project = updateProject(db, plan.projectId, { status: plan.status }, { source: "voice" });
      return done(`“${project.name}” is now ${project.status}.`);
    }
    case "stage": return done(`“${updateProject(db, plan.projectId, { stage: plan.text }, { source: "voice" }).name}” is now at: ${plan.text}.`);
    case "step": {
      const item = addProjectItem(db, plan.projectId, { kind: "step", text: plan.text, source: "voice" });
      return done(`added the step “${item.text}” to ${getProject(db, plan.projectId)!.name}.`);
    }
    case "log": {
      const item = addProjectItem(db, plan.projectId, { kind: "log", text: plan.text, source: "voice" });
      return done(`noted on ${getProject(db, plan.projectId)!.name}: ${item.text}`);
    }
  }
}

/** Null means "use the agent": not about projects, unsure, or it failed. */
export async function fastProjectAction(deps: { db: Db; provider: LLMProvider }, request: string, recent: string, signal?: AbortSignal): Promise<string | null> {
  const live = listProjects(deps.db), gone = removedProjects(deps.db, 5);
  if (!projectCandidate(request, [...live, ...gone].map((project) => project.name)) || signal?.aborted) return null;
  let plan: ProjectPlan;
  try {
    plan = parseProjectPlan(await deps.provider.complete({
      model: deps.provider.defaultSideModel,
      system: SYSTEM,
      user: [
        `Projects: ${live.length ? live.map((project) => `${project.id} | ${project.name} | ${project.kind} | ${project.status}`).join("; ") : "none"}`,
        `Recently removed, newest first: ${gone.length ? gone.map((project) => `${project.id} | ${project.name}`).join("; ") : "none"}`,
        recent ? `Recent conversation:\n${recent.slice(-1_200)}` : "",
        `Request: "${request.slice(0, 600)}"`,
      ].filter(Boolean).join("\n"),
      maxTokens: 120,
    }), new Set(live.map((project) => project.id)), new Set(gone.map((project) => project.id)));
  } catch {
    return null;
  }
  if (plan.action === "agent" || signal?.aborted) return null;
  try {
    return runProjectPlan(deps.db, plan);
  } catch (error) {
    // A refusal is still an answer Sir should hear (for example a duplicate name).
    return error instanceof ProjectError ? `Not done: ${error.message}` : null;
  }
}
