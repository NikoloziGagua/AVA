import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectDetail } from "./api.js";

const mock = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), restore: vi.fn(),
  addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), conversation: vi.fn(), send: vi.fn(),
}));
vi.mock("./api.js", () => ({
  fetchProjects: mock.list, fetchProject: mock.get, createProject: mock.create, updateProject: mock.update, removeProject: mock.remove,
  restoreProject: mock.restore, addItem: mock.addItem, updateItem: mock.updateItem, deleteItem: mock.deleteItem, openConversation: mock.conversation,
}));
vi.mock("../api.js", async (original) => ({ ...(await original<typeof import("../api.js")>()), api: { sendMessage: mock.send } }));
vi.mock("../chat/useChatStream.js", () => ({ useChatStream: () => ({ events: [] }) }));
vi.mock("../design/metal/Atmosphere.js", () => ({ Atmosphere: () => null }));
import { ProjectsScreen } from "./ProjectsScreen.js";

const NOW = Date.parse("2030-09-30T11:00:00Z");
const project = (over: Partial<Project> = {}): Project => ({
  id: "proj_tyre", name: "Test tyre business", kind: "business", status: "active", stage: "Finding a van", goal: "",
  summary: "Comparing test equipment packages.", nextStep: "Shortlist three test vans", folderId: "folder_1", sessionId: null,
  version: 1, createdAt: NOW - 86_400_000, updatedAt: NOW, removedAt: null, ...over,
});
const tyre = project(), agile = project({ id: "proj_agile", name: "Test course", kind: "uni", stage: "", summary: "", nextStep: "" });
const detailOf = (p: Project): ProjectDetail => ({
  project: p,
  steps: p.id === "proj_tyre" ? [{ id: "pitem_1", projectId: p.id, kind: "step", text: "Get two test quotes", doneAt: null, source: "chat", createdAt: NOW }] : [],
  questions: [], log: [{ id: "pitem_log", projectId: p.id, kind: "log", text: "Project started.", doneAt: null, source: "voice", createdAt: NOW }],
  notes: [],
});

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  for (const fn of Object.values(mock)) fn.mockReset();
  mock.list.mockResolvedValue({ projects: [tyre, agile], removed: [], fetchedAt: NOW });
  mock.get.mockImplementation(async (id: string) => detailOf(id === "proj_agile" ? agile : tyre));
  mock.conversation.mockResolvedValue({ sessionId: "session_tyre", messages: [{ id: 1, role: "assistant", content: "Did you find a van?", createdAt: NOW }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Projects tab", () => {
  it("lists projects by group and opens one with its next step, steps and conversation", async () => {
    render(<ProjectsScreen />);
    expect(await screen.findByRole("heading", { name: /Test tyre business/ })).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Projects" });
    expect(within(rail).getByText("BUSINESS")).toBeTruthy();
    expect(within(rail).getByText("UNI")).toBeTruthy();
    expect(await screen.findByText("Shortlist three test vans")).toBeTruthy();
    expect(screen.getByText("Get two test quotes")).toBeTruthy();
    expect(await within(screen.getByRole("complementary", { name: "Discuss with AVA" })).findByText("Did you find a van?")).toBeTruthy();
    fireEvent.click(within(rail).getByRole("button", { name: /Test course/ }));
    expect(await screen.findByRole("heading", { name: /Test course/ })).toBeTruthy();
    expect(screen.getByText("No next step yet. Ask AVA, or write one.")).toBeTruthy();
  });

  it("removes a project at once and brings it back with Undo", async () => {
    render(<ProjectsScreen />);
    await screen.findByRole("heading", { name: /Test tyre business/ });
    mock.remove.mockResolvedValueOnce({ ...tyre, removedAt: NOW });
    mock.list.mockResolvedValueOnce({ projects: [agile], removed: [tyre], fetchedAt: NOW });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Removed “Test tyre business”/)).toBeTruthy();
    expect(mock.remove).toHaveBeenCalledWith("proj_tyre");
    mock.restore.mockResolvedValueOnce(tyre);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("“Test tyre business” is back.")).toBeTruthy();
    expect(mock.restore).toHaveBeenCalledWith("proj_tyre");
  });

  it("adds a project, ticks a step, and changes status by naming the version on screen", async () => {
    render(<ProjectsScreen />);
    await screen.findByRole("heading", { name: /Test tyre business/ });
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Data Science" } });
    fireEvent.click(screen.getByRole("button", { name: "Uni" }));
    mock.create.mockResolvedValueOnce(project({ id: "proj_ds", name: "Data Science", kind: "uni" }));
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await screen.findByText("Added “Data Science”.");
    expect(mock.create).toHaveBeenCalledWith("Data Science", "uni");

    fireEvent.click(screen.getByRole("button", { name: /Test tyre business/ }));
    await screen.findByText("Get two test quotes");
    mock.updateItem.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: /^To do: Get two test quotes/ }));
    await waitFor(() => expect(mock.updateItem).toHaveBeenCalledWith(expect.objectContaining({ id: "pitem_1" }), { done: true }));
    mock.update.mockResolvedValueOnce({ ...tyre, status: "paused" });
    fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Paused" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledWith(tyre, { status: "paused" }));
  });

  it("sends a message into the project's own conversation", async () => {
    render(<ProjectsScreen />);
    const talk = await screen.findByRole("textbox", { name: "Talk about Test tyre business" });
    await waitFor(() => expect((talk as HTMLInputElement).disabled).toBe(false));
    mock.send.mockResolvedValueOnce({ sessionId: "session_tyre", taskId: "task_1" });
    fireEvent.change(talk, { target: { value: "Found a van for 12k" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mock.send).toHaveBeenCalledWith("session_tyre", "Found a van for 12k"));
    expect(await screen.findByText("AVA is thinking…")).toBeTruthy();
  });

  it("shows an empty state with no projects", async () => {
    mock.list.mockResolvedValue({ projects: [], removed: [], fetchedAt: NOW });
    render(<ProjectsScreen />);
    expect(await screen.findByText("No projects yet.")).toBeTruthy();
  });
});
