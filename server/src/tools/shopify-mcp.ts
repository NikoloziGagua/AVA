import type { ToolDef } from "./ava-mcp.js";

// Shopify Admin API tools — edit products DIRECTLY over the API instead of
// clicking through the admin UI in a browser (which was slow and failed mid-task).
// One product edit = one PUT. Images are a separate field we never send, so a
// name/description edit cannot disturb the product's pictures.

const API_VERSION = "2024-10";
const TIMEOUT_MS = 20_000;

export type ShopifyDeps = {
  /** Store domain, e.g. "my-store.myshopify.com". */
  store: string;
  /** Admin API access token (shpat_…). */
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

function baseUrl(store: string): string {
  const host = store.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/admin/api/${API_VERSION}`;
}

async function api(deps: ShopifyDeps, path: string, init?: RequestInit): Promise<Response> {
  const doFetch = deps.fetchImpl ?? fetch;
  return doFetch(`${baseUrl(deps.store)}/${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": deps.token,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
}

export function buildShopifyTools(deps: ShopifyDeps): ToolDef[] {
  return [
    {
      tool: {
        name: "shopify_list_products",
        description:
          "List products from Sir's Shopify store via the Admin API (NOT the browser). " +
          "Returns each product's id and title (name) — use it to find the product ids before " +
          "editing. Args: { limit?, query? }. `query` filters titles by a case-insensitive " +
          "contains-match (e.g. a fighter's name).",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "max products to scan (default 100, cap 250)" },
            query: { type: "string", description: "optional title contains-filter" },
          },
        },
      },
      run: async (args) => {
        const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 250);
        let r: Response;
        try {
          r = await api(deps, `products.json?limit=${limit}&fields=id,title,handle`);
        } catch (e) {
          return { ok: false, text: `Shopify request failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (!r.ok) return { ok: false, text: `Shopify list failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
        const j = (await r.json()) as { products?: Array<{ id: number; title: string }> };
        let products = j.products ?? [];
        const q = String(args.query ?? "").trim().toLowerCase();
        if (q) products = products.filter((p) => (p.title ?? "").toLowerCase().includes(q));
        if (products.length === 0) return { ok: true, text: q ? `No products match "${q}".` : "No products found." };
        return { ok: true, text: products.map((p) => `${p.id} — ${p.title}`).join("\n") };
      },
    },
    {
      tool: {
        name: "shopify_get_product",
        description:
          "Get ONE Shopify product's full current name + description (body_html) so you see EXACTLY " +
          "what's there — including any <img> picture tags embedded in the description — before you " +
          "edit it. Always call this before shopify_update_product. Args: { id }.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "the product id" } },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "").trim();
        if (!id) return { ok: false, text: "missing id" };
        let r: Response;
        try {
          r = await api(deps, `products/${encodeURIComponent(id)}.json?fields=id,title,body_html,images`);
        } catch (e) {
          return { ok: false, text: `Shopify request failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (!r.ok) return { ok: false, text: `Shopify get failed: ${r.status}` };
        const j = (await r.json()) as { product?: { id: number; title: string; body_html: string; images?: unknown[] } };
        const p = j.product;
        if (!p) return { ok: false, text: `No product ${id}.` };
        const imgCount = p.images?.length ?? 0;
        return {
          ok: true,
          text:
            `id: ${p.id}\nname: ${p.title}\nproduct images: ${imgCount}\n\n` +
            `description (body_html) — keep any <img> tags below intact when editing:\n${p.body_html ?? ""}`,
        };
      },
    },
    {
      tool: {
        name: "shopify_update_product",
        description:
          "Update ONE Shopify product's name and/or description via the Admin API — directly, no " +
          "clicking. Pass only what you're changing: { id, title?, body_html? }. This NEVER touches " +
          "the product's images (the images array is never sent). CRITICAL: if the description " +
          "(body_html) contains <img> tags, you MUST keep those exact <img> tags in the new body_html " +
          "— change the text around them, never remove or alter the pictures. Always call " +
          "shopify_get_product first so you're editing the real current description.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "the product id" },
            title: { type: "string", description: "new product name (omit to leave unchanged)" },
            body_html: { type: "string", description: "new description HTML, with original <img> tags preserved (omit to leave unchanged)" },
          },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = String(args.id ?? "").trim();
        if (!id) return { ok: false, text: "missing id" };
        const product: Record<string, unknown> = { id };
        if (typeof args.title === "string") product.title = args.title;
        if (typeof args.body_html === "string") product.body_html = args.body_html;
        if (Object.keys(product).length === 1) {
          return { ok: false, text: "nothing to update — pass title and/or body_html" };
        }
        let r: Response;
        try {
          r = await api(deps, `products/${encodeURIComponent(id)}.json`, {
            method: "PUT",
            body: JSON.stringify({ product }),
          });
        } catch (e) {
          return { ok: false, text: `Shopify request failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (!r.ok) return { ok: false, text: `Shopify update failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}` };
        const j = (await r.json()) as { product?: { id: number; title: string } };
        return { ok: true, text: `Updated product ${j.product?.id ?? id}: "${j.product?.title ?? ""}". Images untouched.` };
      },
    },
  ];
}
