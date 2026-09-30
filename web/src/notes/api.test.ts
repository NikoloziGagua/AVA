// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNote, fetchNote, fetchNotes } from "./api.js";
import { ApiError, UnconfirmedWriteError } from "../api.js";

const fetchMock = vi.fn();
const valid = { id: "note_fixture", title: "A thought", content: "[redacted]", kind: "idea", section: "capture", version: 1, createdAt: 1, updatedAt: 1, status: "ideas", pinned: false, tags: [], links: [], changeLog: [] };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); localStorage.setItem("ava.token", "test-only-token"); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("Notes client boundaries", () => {
  it("reads authoritative long tool-created records without applying HTTP create limits", async () => {
    const stored = { ...valid, title: "A".repeat(200), content: "Stored source. ".repeat(3000) };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ note: stored })));
    expect(await fetchNote(valid.id)).toEqual(stored);
  });
  it("resolves only the exact encoded ID and rejects mismatched or malformed records", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ note: { ...valid, id: "id/with space" } })));
    expect((await fetchNote("id/with space")).id).toBe("id/with space");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/notes/id%2Fwith%20space");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ note: valid })));
    await expect(fetchNote("a-different-id")).rejects.toMatchObject({ code: "invalid_note_receipt" });
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await expect(fetchNote("missing-receipt")).rejects.toMatchObject({ code: "invalid_note_receipt" });
  });
  it("keeps default reads compatible and sends a typed server-side kind filter", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ notes: [], projects: [] })));
    await fetchNotes(); await fetchNotes({ kind: "idea" });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/notes", "/api/notes?kind=idea"]);
    expect(fetchMock.mock.calls[1]![1].headers.get("authorization")).toBe("Bearer test-only-token");
  });

  it.each(["idea", "general", "documentation"] as const)("accepts a generic %s receipt without comparing server-scrubbed content", async kind => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ note: { ...valid, kind } })));
    const result = await createNote({ content: "Source before server sanitization", kind });
    expect(result.content).toBe("[redacted]");
    expect(result.kind).toBe(kind);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["<html>not a receipt</html>", "", "null", "{}", '{"note":null}', JSON.stringify({ note: { ...valid, id: "" } }), JSON.stringify({ note: { ...valid, version: 0 } }), JSON.stringify({ note: { ...valid, kind: "unknown" } }), JSON.stringify({ note: { ...valid, section: "unknown" } })])("rejects malformed 2xx without another write: %s", async body => {
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await expect(createNote({ content: "Keep me", kind: "idea" })).rejects.toBeInstanceOf(UnconfirmedWriteError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 503])("preserves HTTP %s classification", async status => {
    fetchMock.mockResolvedValue(new Response('{"error":"bad_request"}', { status }));
    await expect(createNote({ content: "Keep me" })).rejects.toMatchObject({ name: "ApiError", status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves network uncertainty without replay", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network failed"));
    await expect(createNote({ content: "Keep me" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
