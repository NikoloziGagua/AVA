import { describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { createProject, listProjects, removedProjects } from "../projects/store.js";
import { fastProjectAction, parseProjectPlan, projectCandidate } from "./project-actions.js";

function provider(reply: (user: string) => string): LLMProvider & { calls: number } {
  const fake = {
    name: "openai" as const, defaultOrchestratorModel: "big", defaultSideModel: "small", calls: 0,
    stream: async function* () { /* unused */ },
    complete: vi.fn(async (input: { user: string }) => { fake.calls += 1; return reply(input.user); }),
  };
  return fake as unknown as LLMProvider & { calls: number };
}
const plan = (value: Record<string, unknown>) => JSON.stringify({ project_id: null, name: null, kind: null, status: null, text: null, ...value });

describe("fast project actions", () => {
  it("only wakes for project requests, and not for Sir saying AVA's name", () => {
    const names = ["Mobile tyre fitting", "AVA", "Agile Development"];
    expect(projectCandidate("remove the tire business", names)).toBe(true);
    expect(projectCandidate("add a uni project for Data Science", names)).toBe(true);
    expect(projectCandidate("what's the next step on agile", names)).toBe(true);
    expect(projectCandidate("Ava, what's on my calendar this week?", names)).toBe(false);
    expect(projectCandidate("tell me a joke", names)).toBe(false);
  });

  it("accepts only a plan that names a real project", () => {
    const known = new Set(["proj_a"]), removed = new Set(["proj_old"]);
    expect(parseProjectPlan(plan({ action: "remove", project_id: "proj_a" }), known, removed)).toEqual({ action: "remove", projectId: "proj_a" });
    expect(parseProjectPlan(plan({ action: "remove", project_id: "proj_made_up" }), known, removed)).toEqual({ action: "agent" });
    expect(parseProjectPlan(plan({ action: "restore", project_id: "proj_old" }), known, removed)).toEqual({ action: "restore", projectId: "proj_old" });
    expect(parseProjectPlan(plan({ action: "create", name: "Data Science", kind: "school" }), known, removed)).toEqual({ action: "agent" });
    expect(parseProjectPlan("not json", known, removed)).toEqual({ action: "agent" });
  });

  it("adds, removes and brings back a project at once, and hands a discussion to the agent", async () => {
    const db = openInMemoryDb();
    const tyre = createProject(db, { name: "Mobile tyre fitting", kind: "business", source: "app" });
    const added = await fastProjectAction({ db, provider: provider(() => plan({ action: "create", name: "Data Science", kind: "uni" })) }, "add a uni project for data science", "");
    expect(added).toContain("“Data Science” is added under Uni");
    const removed = await fastProjectAction({ db, provider: provider(() => plan({ action: "remove", project_id: tyre.id })) }, "remove the tyre project", "");
    expect(removed).toContain("“Mobile tyre fitting” is removed");
    expect(listProjects(db).map((project) => project.name)).toEqual(["Data Science"]);
    const back = await fastProjectAction({ db, provider: provider(() => plan({ action: "restore", project_id: tyre.id })) }, "bring the tyre project back", "");
    expect(back).toContain("is back");
    expect(removedProjects(db)).toEqual([]);
    const duplicate = await fastProjectAction({ db, provider: provider(() => plan({ action: "create", name: "data science", kind: "uni" })) }, "add a project data science", "");
    expect(duplicate).toMatch(/^Not done: There is already a project called Data Science/);
    const talk = provider(() => plan({ action: "agent" }));
    expect(await fastProjectAction({ db, provider: talk }, "let's brainstorm the tyre project", "")).toBeNull();
    const idle = provider(() => plan({ action: "list" }));
    expect(await fastProjectAction({ db, provider: idle }, "what's the weather", "")).toBeNull();
    expect(idle.calls).toBe(0);
  });
});
