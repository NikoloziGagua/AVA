import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryItem, MemoryOverview } from "./archive-api.js";

const api = vi.hoisted(() => ({
  overview: vi.fn(), detail: vi.fn(), search: vi.fn(), correct: vi.fn(), carry: vi.fn(), confirm: vi.fn(), forget: vi.fn(),
  playbooks: vi.fn(), people: vi.fn(), deletePlaybook: vi.fn(),
}));
vi.mock("./archive-api.js", async (original) => ({
  ...(await original<typeof import("./archive-api.js")>()),
  fetchMemoryOverview: api.overview, fetchMemoryDetail: api.detail, searchMemory: api.search,
  correctMemory: api.correct, setMemoryCarry: api.carry, confirmMemory: api.confirm, forgetMemory: api.forget,
}));
vi.mock("../api.js", async (original) => ({
  ...(await original<typeof import("../api.js")>()),
  fetchPlaybooks: api.playbooks, fetchPeople: api.people, deletePlaybook: api.deletePlaybook,
}));
vi.mock("../design/metal/Atmosphere.js", () => ({ Atmosphere: () => null }));
vi.mock("./MemoryMap.js", () => ({ MemoryMap: () => <p>Map fixture</p> }));
import { ApiError } from "../api.js";
import { MemoryScreen } from "./MemoryScreen.js";

const NOW = Date.parse("2030-09-30T11:00:00Z");
const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: "mem_phone", kind: "fact", topic: "test phone", text: "Niko uses a test phone.", speechAct: "stated", status: "active",
  carry: true, sensitive: false, confidence: "high", origin: "conversation", saidAt: Date.parse("2030-08-11T21:52:00Z"),
  validTo: null, dueAt: null, supersedesId: null, supersededById: null, hasSources: true, version: 1, ...over,
});
const phone = item();
const friend = item({ id: "mem_friend", kind: "person", topic: "sample friend", text: "Sample Friend is Niko's gym partner.", speechAct: "requested", origin: "explicit" });
const rule = item({ id: "mem_rule", kind: "preference", topic: "fixtures", text: "Keep test fixtures synthetic.", carry: false });
const waiting = item({ id: "mem_wait", topic: "test salary", text: "Niko earns a test salary.", status: "unconfirmed", sensitive: true });
const old = item({ id: "mem_old", topic: "test town", text: "Niko lives in Old Test Town.", status: "history", validTo: NOW - 3_600_000, supersededById: "mem_town" });
const overview: MemoryOverview = {
  enabled: true, fetchedAt: NOW, records: [phone, friend, rule, waiting], history: [old],
  events: [
    { seq: 3, recordId: "mem_gone_a", action: "forgotten", actor: "niko", summary: null, createdAt: NOW - 1_000 },
    { seq: 2, recordId: "mem_gone_b", action: "forgotten", actor: "niko", summary: null, createdAt: NOW - 1_500 },
    { seq: 1, recordId: "mem_friend", action: "added", actor: "extractor", summary: "Sample Friend is Niko's gym partner.", createdAt: NOW - 60_000 },
  ],
  counts: { active: 3, history: 1, unconfirmed: 1, forgotten: 2 },
};
const detailOf = (record: MemoryItem) => ({
  record, chain: [], sources: [{ id: 7, sessionId: "session-fixture", speaker: "niko" as const, text: `quoted line for ${record.id}`, at: NOW - 86_400_000 }],
});

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  for (const mock of Object.values(api)) mock.mockReset();
  api.overview.mockResolvedValue(overview);
  api.detail.mockImplementation(async (id: string) => detailOf([...overview.records, ...overview.history].find((record) => record.id === id)!));
  api.search.mockResolvedValue([old]);
  api.playbooks.mockResolvedValue([]);
  api.people.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const aside = () => screen.getByRole("complementary", { name: "Selected memory" });
const sections = () => screen.getByRole("navigation", { name: "Memory sections" });

describe("Memory tab", () => {
  it("shows what AVA knows by section, with where each memory came from", async () => {
    const onOpenChat = vi.fn();
    render(<MemoryScreen onOpenChat={onOpenChat} />);
    await screen.findByText("3 things I know about you, from what you told me.");
    expect(within(sections()).getByRole("button", { name: "About you, 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(aside()).getByText("Always in mind.")).toBeTruthy();
    expect(await within(aside()).findByText(/quoted line for mem_phone/)).toBeTruthy();
    fireEvent.click(within(aside()).getByRole("button", { name: "Open conversation" }));
    expect(onOpenChat).toHaveBeenCalledWith("session-fixture");

    fireEvent.click(within(sections()).getByRole("button", { name: "People, 1" }));
    expect(screen.getByRole("button", { name: /Sample Friend is Niko's gym partner\..*you asked me to remember/ })).toBeTruthy();
    fireEvent.click(within(sections()).getByRole("button", { name: "Waiting for you, 1" }));
    expect(screen.getByRole("button", { name: /Niko earns a test salary\..*private/ })).toBeTruthy();
    expect(within(aside()).getByText("Not kept yet.")).toBeTruthy();
    fireEvent.click(within(sections()).getByRole("button", { name: "History, 1" }));
    expect(screen.getByRole("button", { name: /Niko lives in Old Test Town\..*until 30 Sept?/ })).toBeTruthy();
    expect(within(aside()).queryByRole("button", { name: "Forget" })).toBeNull();

    // One forget erases every version, so the feed says it once; a learned memory opens where it lives.
    const feed = within(aside()).getByRole("region", { name: "Just learned" });
    expect(within(feed).getAllByText("Something you asked me to forget")).toHaveLength(1);
    fireEvent.click(within(feed).getByRole("button", { name: /Sample Friend/ }));
    expect(within(sections()).getByRole("button", { name: "People, 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(aside()).getByText("Sample Friend is Niko's gym partner.", { selector: ".ds-memory-big" })).toBeTruthy();
  });

  it("fixes a memory by naming the version on screen, and reloads when AVA changed it first", async () => {
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    fireEvent.click(within(aside()).getByRole("button", { name: "Fix" }));
    const box = within(aside()).getByLabelText("Fix what I remember");
    expect(within(aside()).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.change(box, { target: { value: "Niko uses a newer test phone." } });
    api.correct.mockResolvedValueOnce(item({ id: "mem_phone_2", text: "Niko uses a newer test phone.", origin: "explicit", hasSources: false }));
    fireEvent.click(within(aside()).getByRole("button", { name: "Save" }));
    await screen.findByText("Saved. I’ll use this from now on.");
    expect(api.correct).toHaveBeenCalledWith(phone, "Niko uses a newer test phone.");
    expect(api.overview).toHaveBeenCalledTimes(2);

    fireEvent.click(within(aside()).getByRole("button", { name: "Fix" }));
    fireEvent.change(within(aside()).getByLabelText("Fix what I remember"), { target: { value: "Something else." } });
    api.correct.mockRejectedValueOnce(new ApiError(409, "Memory mem_phone changed.", "stale_version"));
    fireEvent.click(within(aside()).getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This changed since you opened it, so nothing was saved. Showing the latest now.");
    expect(within(aside()).queryByLabelText("Fix what I remember")).toBeNull();
    expect(api.overview).toHaveBeenCalledTimes(3);
  });

  it("asks before forgetting, and keeps or drops what is waiting", async () => {
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    fireEvent.click(within(aside()).getByRole("button", { name: "Forget" }));
    const ask = within(aside()).getByRole("group", { name: "Confirm forget" });
    expect(ask.textContent).toContain("I also forget the lines it came from");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(api.forget).not.toHaveBeenCalled();
    fireEvent.click(within(aside()).getByRole("button", { name: "Forget" }));
    api.forget.mockResolvedValueOnce({ ok: true, forgotten: 1 });
    fireEvent.click(within(within(aside()).getByRole("group", { name: "Confirm forget" })).getByRole("button", { name: "Forget" }));
    await screen.findByText("Forgotten, along with the lines it came from.");
    expect(api.forget).toHaveBeenCalledWith(phone);

    fireEvent.click(within(sections()).getByRole("button", { name: "Waiting for you, 1" }));
    api.confirm.mockResolvedValueOnce({ ...waiting, status: "active", version: 2 });
    fireEvent.click(within(aside()).getByRole("button", { name: "Keep" }));
    await screen.findByText("Kept. It’s in About you now.");
    expect(api.confirm).toHaveBeenCalledWith(waiting);

    fireEvent.click(within(aside()).getByRole("button", { name: "Drop" }));
    api.forget.mockResolvedValueOnce({ ok: true, forgotten: 1 });
    fireEvent.click(within(within(aside()).getByRole("group", { name: "Confirm drop" })).getByRole("button", { name: "Drop" }));
    await screen.findByText("Dropped. I won’t keep it.");
    expect(api.forget).toHaveBeenLastCalledWith(waiting);
  });

  it("stops bringing a memory up, and brings it back", async () => {
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    api.carry.mockResolvedValueOnce({ ...phone, carry: false, version: 2 });
    fireEvent.click(within(aside()).getByRole("button", { name: "Stop bringing up" }));
    await screen.findByText("Kept, but I’ll only use it when you ask.");
    expect(api.carry).toHaveBeenCalledWith(phone, false);

    fireEvent.click(within(sections()).getByRole("button", { name: "Your rules, 1" }));
    expect(screen.getByRole("button", { name: /Keep test fixtures synthetic\..*only when asked/ })).toBeTruthy();
    expect(within(aside()).getByText("Only when you ask.")).toBeTruthy();
    api.carry.mockResolvedValueOnce({ ...rule, carry: true, version: 2 });
    fireEvent.click(within(aside()).getByRole("button", { name: "Bring it up again" }));
    await screen.findByText("Back in everyday memory.");
    expect(api.carry).toHaveBeenLastCalledWith(rule, true);
  });

  it("searches everything, including older versions", async () => {
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search what AVA remembers" }), { target: { value: "town" } });
    expect(await screen.findByRole("heading", { name: "Results for “town”" })).toBeTruthy();
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("town"));
    expect(await screen.findByRole("button", { name: /Niko lives in Old Test Town\..*old/ })).toBeTruthy();
    expect(screen.getByText("1 found, including older versions.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy();
  });

  it("on a phone, opens a memory in place and shows the latest learning on top", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(within(sections()).getByRole("button", { name: "Learned how-tos" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Just learned" })).toBeTruthy();
    expect(screen.queryByText("Where this came from")).toBeNull();
    const row = screen.getByRole("button", { name: /Niko uses a test phone\./ });
    fireEvent.click(row);
    expect(await screen.findByText(/quoted line for mem_phone/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix" })).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByText("Where this came from")).toBeNull();
  });

  it("lists learned how-tos AVA still uses first, and forgets one only after asking", async () => {
    const book = { trigger: "", keywords: [], created: "2030-08-01", last_used: "2030-09-28", stakes: "routine", version: 1, succ: 0, fail: 0, avg_secs: 4, lessons: [] };
    api.playbooks.mockResolvedValue([
      { ...book, slug: "open-test-chat", trigger: "Open a test chat", uses: 33, steps: ["Open the test app", "Pick the chat"], offered: true },
      { ...book, slug: "retired-test", trigger: "A retired test shortcut", uses: 29, steps: ["Do nothing"], offered: false },
    ]);
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    fireEvent.click(within(sections()).getByRole("button", { name: "Learned how-tos" }));
    const detail = await screen.findByRole("complementary", { name: "Selected how-to" });
    expect(await within(detail).findByText("Pick the chat")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No longer used" })).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "Forget this how-to" }));
    api.deletePlaybook.mockResolvedValueOnce(undefined);
    fireEvent.click(within(within(detail).getByRole("group", { name: "Confirm forget" })).getByRole("button", { name: "Forget" }));
    await screen.findByText("Forgot how to “Open a test chat”.");
    expect(api.deletePlaybook).toHaveBeenCalledWith("open-test-chat");
  });

  it("shows contacts read-only, with the names Niko uses", async () => {
    api.people.mockResolvedValue([{ id: "p1", name: "Sample Friend", aliases: ["Sammy"], instagram: { username: "sample_friend", threadId: "t1" }, updated: "2030-09-30" }]);
    render(<MemoryScreen />);
    await screen.findByText("3 things I know about you, from what you told me.");
    fireEvent.click(within(sections()).getByRole("button", { name: "Contacts" }));
    const detail = await screen.findByRole("complementary", { name: "Selected contact" });
    expect(await within(detail).findByText("You also call them Sammy.")).toBeTruthy();
    expect(within(detail).getByText("Instagram @sample_friend · I’ve opened this chat before")).toBeTruthy();
    expect(within(detail).queryByRole("button")).toBeNull();
  });

  it("says so when the new memory is switched off, and offers a retry when loading fails", async () => {
    api.overview.mockRejectedValueOnce(new ApiError(0, "AVA's server is unreachable.", "server_unreachable"));
    render(<MemoryScreen />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("AVA's server is unreachable.");
    api.overview.mockResolvedValueOnce({ ...overview, enabled: false });
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The new memory is switched off, so I’m not using these right now.")).toBeTruthy();
  });
});
