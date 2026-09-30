import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type OpenAI from "openai";
import { openInMemoryDb } from "../state/db.js";
import { createProject, projectBrief, projectDetail, removeProject } from "./store.js";
import { addFile, addLink, getMaterial, listMaterials, materialPath, publicUrl, removeMaterial } from "./materials.js";
import { extractMaterial, fetchPage, htmlText, parseTakeaways } from "./extract.js";
import { projectRoutes } from "../routes/projects.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fakeOpenAI(reply: string) {
  const create = vi.fn(async () => ({ choices: [{ message: { content: reply } }] }));
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

describe("project materials", () => {
  it("keeps only public web links", () => {
    expect(publicUrl("https://www.donedeal.ie/vans")?.hostname).toBe("www.donedeal.ie");
    for (const bad of ["http://localhost:8787/api", "http://192.168.1.4", "http://10.0.0.1", "file:///C:/x", "https://nikasi.tail7ec5d3.ts.net", "http://100.100.1.1", "https://user:pw@example.com"]) {
      expect(publicUrl(bad), bad).toBeNull();
    }
  });

  it("stores a photo under the project, reads it once, and puts what matters in the brief and log", async () => {
    const db = openInMemoryDb(), dataDir = mkdtempSync(join(tmpdir(), "ava-mat-"));
    const tyre = createProject(db, { name: "Test tyre business", kind: "business", source: "app" });
    const photo = addFile(db, dataDir, tyre.id, { name: "van listing.png", mime: "image/png", bytes: PNG, source: "app" });
    expect(photo).toMatchObject({ kind: "photo", title: "van listing", status: "pending", fileName: "van listing.png" });
    expect(existsSync(materialPath(dataDir, photo))).toBe(true);
    const model = fakeOpenAI("Title: Test Transit listing\n- Price €12,000\n* Load length 3.3 m");
    await extractMaterial({ db, dataDir, openai: model.client }, photo);
    expect(getMaterial(db, photo.id)).toMatchObject({ status: "ready", title: "Test Transit listing", takeaways: "- Price €12,000\n- Load length 3.3 m" });
    const sent = JSON.stringify(model.create.mock.calls[0]);
    expect(sent).toContain("data:image/png;base64,");
    expect(sent).toContain("Test tyre business");
    expect(projectBrief(db, tyre)).toContain("photo “Test Transit listing”: - Price €12,000 - Load length 3.3 m");
    expect(projectDetail(db, tyre.id)!.log[0]!.text).toBe("Added a photo: Test Transit listing");
    removeMaterial(db, dataDir, photo.id);
    expect(existsSync(materialPath(dataDir, photo))).toBe(false);
    expect(listMaterials(db, tyre.id)).toEqual([]);
  });

  it("refuses unknown file types, private links and removed projects, and records a failed read", async () => {
    const db = openInMemoryDb(), dataDir = mkdtempSync(join(tmpdir(), "ava-mat-"));
    const project = createProject(db, { name: "Test course", kind: "uni", source: "app" });
    expect(() => addFile(db, dataDir, project.id, { name: "x.exe", mime: "application/x-msdownload", bytes: PNG, source: "app" })).toThrow(/photos/);
    expect(() => addLink(db, project.id, { url: "http://localhost/secret", source: "app" })).toThrow(/public web link/);
    const link = addLink(db, project.id, { url: "https://example.com/page", source: "app" });
    await extractMaterial({ db, dataDir, openai: fakeOpenAI("x").client, fetcher: (async () => new Response("gone", { status: 404 })) as typeof fetch }, link);
    expect(getMaterial(db, link.id)).toMatchObject({ status: "failed", takeaways: "The page answered 404." });
    removeProject(db, project.id);
    expect(() => addLink(db, project.id, { url: "https://example.com", source: "app" })).toThrow(/removed/);
  });

  it("follows a redirect only while it stays public, and reads the page text", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("start")
      ? new Response(null, { status: 302, headers: { location: "https://example.com/final" } })
      : new Response("<html><head><title>Van &amp; kit</title><meta name=\"description\" content=\"Transit for sale\"></head><body><script>x()</script><p>Price 12k</p></body></html>", { headers: { "content-type": "text/html" } }));
    expect(await fetchPage("https://example.com/start", fetcher as typeof fetch)).toEqual({ title: "Van & kit", text: "Transit for sale\nVan & kit Price 12k" });
    const sneaky = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8787/api" } }));
    await expect(fetchPage("https://example.com/start", sneaky as typeof fetch)).rejects.toThrow(/private/);
    expect(sneaky).toHaveBeenCalledTimes(1);
    expect(htmlText("<p>a</p>").text).toBe("a");
    expect(parseTakeaways("Nothing useful here.")).toEqual({ title: "", takeaways: "Nothing useful here." });
  });

  it("uploads, serves and deletes a file through the routes", async () => {
    const db = openInMemoryDb(), dataDir = mkdtempSync(join(tmpdir(), "ava-mat-"));
    const app = express();
    app.use(express.json());
    app.use("/api/projects", projectRoutes(db, ((_q: unknown, _s: unknown, next: () => void) => next()) as never, { dataDir, openai: null }));
    const project = createProject(db, { name: "Test tyre business", kind: "business", source: "app" });
    const uploaded = await request(app).post(`/api/projects/${project.id}/materials/upload`)
      .set("content-type", "image/png").set("x-file-name", encodeURIComponent("van.png")).send(PNG).expect(201);
    const id = uploaded.body.material.id;
    const file = await request(app).get(`/api/projects/${project.id}/materials/${id}/file`).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((await request(app).get(`/api/projects/${project.id}`).expect(200)).body.materials).toHaveLength(1);
    await request(app).post(`/api/projects/${project.id}/materials/link`).send({ url: "http://10.0.0.1/admin" }).expect(400);
    await request(app).delete(`/api/projects/${project.id}/materials/${id}`).expect(200);
    await request(app).get(`/api/projects/${project.id}/materials/${id}/file`).expect(404);
  });
});
