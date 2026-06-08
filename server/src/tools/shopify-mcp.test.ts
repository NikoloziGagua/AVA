import { describe, it, expect, vi } from "vitest";
import { buildShopifyTools } from "./shopify-mcp.js";

function fakeRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const run = (tools: ReturnType<typeof buildShopifyTools>, name: string, args: Record<string, unknown>) =>
  tools.find((t) => t.tool.name === name)!.run(args, {} as never);

describe("shopify tools", () => {
  it("lists products as id — title and applies the query filter", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      fakeRes({ products: [{ id: 1, title: "Conor McGregor Tee" }, { id: 2, title: "Khabib Hoodie" }] }));
    const tools = buildShopifyTools({ store: "s.myshopify.com", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });

    const all = await run(tools, "shopify_list_products", {});
    expect(all.text).toContain("1 — Conor McGregor Tee");
    expect(all.text).toContain("2 — Khabib Hoodie");

    const filtered = await run(tools, "shopify_list_products", { query: "khabib" });
    expect(filtered.text).toContain("Khabib");
    expect(filtered.text).not.toContain("Conor");

    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/admin/api/2024-10/products.json");
    expect((fetchImpl.mock.calls[0]![1]!).headers).toMatchObject({ "X-Shopify-Access-Token": "t" });
  });

  it("get_product surfaces the current description WITH its <img> tags", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeRes({ product: { id: 1, title: "Tee", body_html: '<p>Old desc</p><img src="x.jpg">', images: [{ id: 9 }] } }));
    const tools = buildShopifyTools({ store: "s", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, "shopify_get_product", { id: "1" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Old desc");
    expect(r.text).toContain("<img");
    expect(r.text).toContain("product images: 1");
  });

  it("update_product sends ONLY title/body_html — never the images array", async () => {
    let sentBody: { product: Record<string, unknown> } | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return fakeRes({ product: { id: 1, title: "New Name" } });
    });
    const tools = buildShopifyTools({ store: "s", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, "shopify_update_product", {
      id: "1", title: "New Name", body_html: '<p>New text</p><img src="x.jpg">',
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Images untouched");
    expect(sentBody!.product.title).toBe("New Name");
    expect(String(sentBody!.product.body_html)).toContain("<img"); // picture preserved
    expect(sentBody!.product).not.toHaveProperty("images");
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe("PUT");
  });

  it("update_product with nothing to change errors before any request", async () => {
    const fetchImpl = vi.fn(async () => fakeRes({}));
    const tools = buildShopifyTools({ store: "s", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, "shopify_update_product", { id: "1" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("nothing to update");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a Shopify API error status", async () => {
    const fetchImpl = vi.fn(async () => fakeRes({ errors: "not found" }, false, 404));
    const tools = buildShopifyTools({ store: "s", token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await run(tools, "shopify_list_products", {});
    expect(r.ok).toBe(false);
    expect(r.text).toContain("404");
  });
});
