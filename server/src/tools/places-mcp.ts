import type { ToolDef } from "./ava-mcp.js";

// Google Places API (New) — find real businesses with structured data instead of
// scraping Google Maps (blocked + fragile). Each result carries a `websiteUri`, so
// "businesses WITHOUT a website" is a precise filter. Google caps EACH text query at
// ~60 most-prominent results, so the tool also accepts a LIST of queries, runs them
// all, and dedupes — that's how you get past the 60-cap to collect a long list
// (especially niche ones like "no website", which live in the long tail).

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const TIMEOUT_MS = 20_000;
const MAX_QUERIES = 12; // cost guard on a fan-out
const MAX_PAGES = 4; // Google returns at most ~60 (3 pages) per query
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.websiteUri," +
  "places.nationalPhoneNumber,places.googleMapsUri,places.rating,nextPageToken";

export type PlacesDeps = { apiKey: string; fetchImpl?: typeof fetch };

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  rating?: number;
};

function passesFilter(p: Place, filter: string): boolean {
  if (filter === "without") return !p.websiteUri;
  if (filter === "with") return !!p.websiteUri;
  return true;
}

export function buildPlacesTools(deps: PlacesDeps): ToolDef[] {
  return [
    {
      tool: {
        name: "find_places",
        description:
          "Find real businesses/places via the Google Places API (reliable structured data — do NOT " +
          "scrape Google Maps). Returns each place's name, address, phone, website (or 'NO WEBSITE'), " +
          "Maps link and rating. websiteFilter='without' returns ONLY places with no website (great for " +
          "lead lists), 'with' only those with one, 'any' (default) all. " +
          "IMPORTANT: Google caps EACH query at ~60 most-prominent results, and prominent places usually " +
          "HAVE websites — so to collect MANY (especially 'without a website'), pass `queries`: several " +
          "VARIED searches by neighborhood AND synonym, e.g. ['hair salons in Dublin 1','hairdressers in " +
          "Rathmines Dublin','barbers in Dublin 2','beauty salons in Ranelagh Dublin',…]. The tool runs " +
          "them all, DEDUPES, filters, and returns up to maxResults. Use a single `query` only for a " +
          "quick look.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "a single search, e.g. 'hair salons in Dublin'" },
            queries: {
              type: "array",
              items: { type: "string" },
              description: "several searches to fan out + dedupe (PREFERRED for collecting many; vary neighborhood + synonyms to beat the 60-per-query cap)",
            },
            maxResults: { type: "number", description: "how many to return (default 20, cap 60)" },
            websiteFilter: { type: "string", enum: ["any", "without", "with"], description: "filter by website presence" },
          },
        },
      },
      run: async (args) => {
        const list = Array.isArray(args.queries) ? args.queries.map((q) => String(q).trim()).filter(Boolean) : [];
        if (args.query && String(args.query).trim()) list.unshift(String(args.query).trim());
        const queries = [...new Set(list)].slice(0, MAX_QUERIES);
        if (queries.length === 0) return { ok: false, text: "missing query — pass `query` or `queries`" };
        const want = Math.min(Math.max(Number(args.maxResults) || 20, 1), 60);
        const filter = String(args.websiteFilter ?? "any");
        const doFetch = deps.fetchImpl ?? fetch;

        // Dedupe across all queries by place id (fallback: name|address).
        const byKey = new Map<string, Place>();
        const keyOf = (p: Place) => p.id ?? `${p.displayName?.text ?? ""}|${p.formattedAddress ?? ""}`;
        const matchCount = () => {
          let n = 0;
          for (const p of byKey.values()) if (passesFilter(p, filter)) n++;
          return n;
        };

        try {
          for (const q of queries) {
            let pageToken: string | undefined;
            for (let page = 0; page < MAX_PAGES; page++) {
              const body: Record<string, unknown> = { textQuery: q };
              if (pageToken) body.pageToken = pageToken;
              const r = await doFetch(SEARCH_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Goog-Api-Key": deps.apiKey, "X-Goog-FieldMask": FIELD_MASK },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
              });
              if (!r.ok) return { ok: false, text: `Places search failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
              const j = (await r.json()) as { places?: Place[]; nextPageToken?: string };
              for (const p of j.places ?? []) byKey.set(keyOf(p), p);
              if (!j.nextPageToken) break;
              pageToken = j.nextPageToken;
            }
            if (matchCount() >= want) break; // enough matches across the fan-out — stop spending calls
          }
        } catch (e) {
          return { ok: false, text: `Places request failed: ${e instanceof Error ? e.message : String(e)}` };
        }

        const results = [...byKey.values()].filter((p) => passesFilter(p, filter)).slice(0, want);
        const label = queries.length === 1 ? `"${queries[0]}"` : `${queries.length} searches`;
        if (results.length === 0) {
          return { ok: true, text: `No places found for ${label}${filter !== "any" ? ` (filter: ${filter} website)` : ""}.` };
        }
        const lines = results.map((p, i) => {
          const name = p.displayName?.text ?? "(unnamed)";
          const site = p.websiteUri ?? "NO WEBSITE";
          const phone = p.nationalPhoneNumber ? ` · ${p.nationalPhoneNumber}` : "";
          const maps = p.googleMapsUri ? `\n   maps: ${p.googleMapsUri}` : "";
          return `${i + 1}. ${name} — ${p.formattedAddress ?? ""}${phone}\n   website: ${site}${maps}`;
        });
        // When a 'without website' sweep comes up short, say WHY + how to widen it.
        const short = filter === "without" && results.length < want
          ? `\n\n(Only ${results.length} found across ${queries.length} search(es). Google caps each query ` +
            `at ~60 prominent results — add more varied queries (other neighborhoods/synonyms) to surface more.)`
          : "";
        return { ok: true, text: `${results.length} result(s) for ${label}:\n\n${lines.join("\n")}${short}` };
      },
    },
  ];
}
