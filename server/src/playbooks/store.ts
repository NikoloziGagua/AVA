import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

export type Stakes = "routine" | "consequential";
export type Playbook = {
  slug: string; trigger: string; keywords: string[];
  created: string; last_used: string; uses: number; stakes: Stakes; steps: string[];
};

export function slugify(trigger: string): string {
  return trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "playbook";
}

export function serializePlaybook(pb: Playbook): string {
  const head = [
    `trigger: ${pb.trigger}`, `keywords: ${pb.keywords.join(", ")}`,
    `created: ${pb.created}`, `last_used: ${pb.last_used}`,
    `uses: ${pb.uses}`, `stakes: ${pb.stakes}`,
  ].join("\n");
  const steps = pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `---\n${head}\n---\n# Steps\n${steps}\n`;
}

export function parsePlaybook(slug: string, content: string): Playbook | null {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!m) return null;
  const head: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!head.trigger) return null;
  const steps = m[2]!.split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "").trim())
    .filter((l) => l && l !== "# Steps");
  return {
    slug, trigger: head.trigger,
    keywords: (head.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
    created: head.created ?? "", last_used: head.last_used ?? "", uses: Number(head.uses ?? "0"),
    stakes: head.stakes === "consequential" ? "consequential" : "routine", steps,
  };
}

const pbDir = (memoryDir: string) => join(memoryDir, "playbooks");
const pbFile = (memoryDir: string, slug: string) => join(pbDir(memoryDir), `${slug}.md`);

export function writePlaybook(memoryDir: string, pb: Playbook): void {
  mkdirSync(pbDir(memoryDir), { recursive: true });
  writeFile(pbFile(memoryDir, pb.slug), serializePlaybook(pb));
}
export function readPlaybook(memoryDir: string, slug: string): Playbook | null {
  const c = readFile(pbFile(memoryDir, slug));
  return c ? parsePlaybook(slug, c) : null;
}
export function listPlaybooks(memoryDir: string): Playbook[] {
  const d = pbDir(memoryDir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md"))
    .map((f) => readPlaybook(memoryDir, f.replace(/\.md$/, "")))
    .filter((p): p is Playbook => p !== null);
}
export function loadPlaybookIndex(
  memoryDir: string,
): { slug: string; trigger: string; keywords: string[]; uses: number }[] {
  // keywords + uses feed the local recall scorer (match.ts): keywords broaden
  // paraphrase matching, uses breaks ties toward the proven playbook.
  return listPlaybooks(memoryDir).map((p) => ({
    slug: p.slug, trigger: p.trigger, keywords: p.keywords, uses: p.uses,
  }));
}
