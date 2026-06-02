import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, writePlaybook, readPlaybook, listPlaybooks, loadPlaybookIndex, type Playbook } from "./store.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-pb-")); }
const sample = (over: Partial<Playbook> = {}): Playbook => ({
  slug: "download-electricity-bill", trigger: "download the electricity bill",
  keywords: ["electricity", "bill"], created: "2026-06-02", last_used: "2026-06-02",
  uses: 1, stakes: "consequential", steps: ["open the billing page", "download the PDF to Downloads"], ...over,
});

describe("playbook store", () => {
  let d: string;
  beforeEach(() => { d = dir(); });

  it("slugifies a trigger into a safe slug", () => {
    expect(slugify("Download the Electricity Bill!")).toBe("download-the-electricity-bill");
  });

  it("round-trips a playbook through write/read", () => {
    writePlaybook(d, sample());
    const r = readPlaybook(d, "download-electricity-bill")!;
    expect(r.trigger).toBe("download the electricity bill");
    expect(r.keywords).toEqual(["electricity", "bill"]);
    expect(r.uses).toBe(1);
    expect(r.stakes).toBe("consequential");
    expect(r.steps).toEqual(["open the billing page", "download the PDF to Downloads"]);
  });

  it("lists playbooks and exposes a slim index", () => {
    writePlaybook(d, sample());
    writePlaybook(d, sample({ slug: "post-tweet", trigger: "post a tweet", stakes: "routine" }));
    expect(listPlaybooks(d).map((p) => p.slug).sort()).toEqual(["download-electricity-bill", "post-tweet"]);
    expect(loadPlaybookIndex(d).find((e) => e.slug === "post-tweet")!.trigger).toBe("post a tweet");
  });

  it("scrubs secrets in steps on write (memory firewall)", () => {
    writePlaybook(d, sample({ slug: "leaky", steps: ["use key sk-ant-abcdefghijklmnopqrstuvwxyz123456"] }));
    const raw = readFileSync(join(d, "playbooks", "leaky.md"), "utf8");
    expect(raw).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(raw).toContain("sk-ant-***");
  });
});
