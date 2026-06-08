import type { ToolDef } from "./ava-mcp.js";

// Google Places API (New) — find real businesses with structured data instead of
// scraping Google Maps (which is blocked + fragile). Each result carries a
// `websiteUri` field, so "businesses WITHOUT a website" is a precise filter rather
// than a guess. One HTTP call per page of ~20 results.

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const TIMEOUT_MS = 20_000;
const FIELD_MASK =
  "places.displayName,places.formattedAddress,places.websiteUri," +
  "places.nationalPhoneNumber,places.googleMapsUri,places.rating,nextPageToken";

export type PlacesDeps = { apiKey: string; fetchImpl?: typeof fetch };

type Place = {
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  rating?: number;
};

export function buildPlacesTools(deps: PlacesDeps): ToolDef[] {
  return [
    {
      tool: {
        name: "find_places",
        description:
          "Find real businesses/places via the Google Places API (reliable structured data — do NOT " +
          "scrape Google Maps or write a scraper for this). Returns each place's name, address, phone, " +
          "website (or 'NO WEBSITE'), Google Maps link and rating. Use for tasks like 'find hair salons " +
          "in Dublin' or 'plumbers near Cork'. Args: { query, maxResults?, websiteFilter? }. " +
          "websiteFilter='without' returns ONLY places with NO website (e.g. 'salons in Dublin without a " +
          "website'), 'with' only those that have one, 'any' (default) returns all.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "what + where, e.g. 'hair salons in Dublin'" },
            maxResults: { type: "number", description: "how many to return (default 20, cap 60)" },
            websiteFilter: { type: "string", enum: ["any", "without", "with"], description: "filter by website presence" },
          },
          required: ["query"],
        },
      },
      run: async (args) => {
        const query = String(args.query ?? "").trim();
        if (!query) return { ok: false, text: "missing query" };
        const want = Math.min(Math.max(Number(args.maxResults) || 20, 1), 60);
        const filter = String(args.websiteFilter ?? "any");
        const doFetch = deps.fetchImpl ?? fetch;
        const collected: Place[] = [];
        let pageToken: string | undefined;
        try {
          // Page until we have enough raw results (the website filter may drop some)
          // or Google stops returning a nextPageToken. Cap pages so we never loop.
          for (let page = 0; page < 4 && collected.length < want * 2; page++) {
            const body: Record<string, unknown> = { textQuery: query };
            if (pageToken) body.pageToken = pageToken;
            const r = await doFetch(SEARCH_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": deps.apiKey,
                "X-Goog-FieldMask": FIELD_MASK,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!r.ok) {
              return { ok: false, text: `Places search failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
            }
            const j = (await r.json()) as { places?: Place[]; nextPageToken?: string };
            collected.push(...(j.places ?? []));
            if (!j.nextPageToken) break;
            pageToken = j.nextPageToken;
          }
        } catch (e) {
          return { ok: false, text: `Places request failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        let results = collected;
        if (filter === "without") results = results.filter((p) => !p.websiteUri);
        else if (filter === "with") results = results.filter((p) => !!p.websiteUri);
        results = results.slice(0, want);
        if (results.length === 0) {
          return { ok: true, text: `No places found for "${query}"${filter !== "any" ? ` (filter: ${filter} website)` : ""}.` };
        }
        const lines = results.map((p, i) => {
          const name = p.displayName?.text ?? "(unnamed)";
          const site = p.websiteUri ?? "NO WEBSITE";
          const phone = p.nationalPhoneNumber ? ` · ${p.nationalPhoneNumber}` : "";
          const maps = p.googleMapsUri ? `\n   maps: ${p.googleMapsUri}` : "";
          return `${i + 1}. ${name} — ${p.formattedAddress ?? ""}${phone}\n   website: ${site}${maps}`;
        });
        return { ok: true, text: `${results.length} result(s) for "${query}":\n\n${lines.join("\n")}` };
      },
    },
  ];
}
