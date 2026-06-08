import { describe, it, expect, vi } from "vitest";
import { buildPlacesTools } from "./places-mcp.js";

function fakeRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const run = (tools: ReturnType<typeof buildPlacesTools>, args: Record<string, unknown>) =>
  tools[0]!.run(args, {} as never);

const SAMPLE = {
  places: [
    { displayName: { text: "Salon A" }, formattedAddress: "1 St, Dublin", websiteUri: "https://a.ie", nationalPhoneNumber: "01 111" },
    { displayName: { text: "Salon B" }, formattedAddress: "2 St, Dublin", nationalPhoneNumber: "01 222" }, // no website
    { displayName: { text: "Salon C" }, formattedAddress: "3 St, Dublin" }, // no website
  ],
};

describe("find_places", () => {
  it("returns name, address, phone and website with the right headers/body", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => fakeRes(SAMPLE));
    const tools = buildPlacesTools({ apiKey: "KEY", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, { query: "salons in Dublin" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Salon A");
    expect(r.text).toContain("https://a.ie");
    expect(r.text).toContain("NO WEBSITE"); // B and C
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: "salons in Dublin" });
  });

  it("websiteFilter 'without' returns ONLY places with no website", async () => {
    const fetchImpl = vi.fn(async () => fakeRes(SAMPLE));
    const tools = buildPlacesTools({ apiKey: "KEY", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, { query: "salons in Dublin", websiteFilter: "without" });
    expect(r.text).toContain("Salon B");
    expect(r.text).toContain("Salon C");
    expect(r.text).not.toContain("Salon A");
    expect(r.text).not.toContain("https://a.ie");
  });

  it("websiteFilter 'with' returns ONLY places that have a website", async () => {
    const fetchImpl = vi.fn(async () => fakeRes(SAMPLE));
    const tools = buildPlacesTools({ apiKey: "KEY", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, { query: "salons", websiteFilter: "with" });
    expect(r.text).toContain("Salon A");
    expect(r.text).not.toContain("Salon B");
  });

  it("surfaces a Places API error status", async () => {
    const fetchImpl = vi.fn(async () => fakeRes({ error: { message: "bad key" } }, false, 403));
    const tools = buildPlacesTools({ apiKey: "KEY", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, { query: "x" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("403");
  });

  it("missing query errors without calling the API", async () => {
    const fetchImpl = vi.fn(async () => fakeRes(SAMPLE));
    const tools = buildPlacesTools({ apiKey: "KEY", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, {});
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
