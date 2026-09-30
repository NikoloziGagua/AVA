import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

export type Stakes = "routine" | "consequential";
export type PlaybookLearningStats = {
  verified: number;
  partially_verified: number;
  unverified: number;
  contradicted: number;
  failed: number;
  not_applicable: number;
  last_task_id: string;
  last_method: string;
  last_evidence_at: number;
  recent_task_ids: string[];
};

export const EMPTY_PLAYBOOK_LEARNING: PlaybookLearningStats = {
  verified: 0,
  partially_verified: 0,
  unverified: 0,
  contradicted: 0,
  failed: 0,
  not_applicable: 0,
  last_task_id: "",
  last_method: "",
  last_evidence_at: 0,
  recent_task_ids: [],
};

export type Playbook = {
  slug: string; trigger: string; keywords: string[];
  created: string; last_used: string; uses: number; stakes: Stakes; steps: string[];
  /** Schema revision of the PROCEDURE: bumped when a re-capture merges fresher
   *  steps into an existing playbook (identity/slug stays stable). */
  version: number;
  /** Outcome record when this playbook was recalled: runs that reached a final
   *  reply vs runs that ended in error/kill. Feeds demotion in match(). */
  succ: number; fail: number;
  /** Rolling average duration (seconds) of successful runs — lets Ava (and
   *  Sir) see whether a procedure is getting faster over versions. */
  avg_secs: number;
  /** Hard-won advice distilled from failed/blocked steps ("Google bot-walls
   *  automation — go straight to wttr.in"). Injected at recall so the same
   *  wall is never hit twice. */
  lessons: string[];
  /** Evidence-aware outcomes. `succ`/`fail` above are retained as immutable
   * legacy reported-result counters and are never used as new proof. */
  learning?: PlaybookLearningStats;
};

export function slugify(trigger: string): string {
  return trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "playbook";
}

export function serializePlaybook(pb: Playbook): string {
  // Defensive defaults: callers (and old fixtures) may hold pre-v2 objects
  // without the metrics fields — treat those as version-1 zero-record books.
  const lessons = pb.lessons ?? [];
  const learning = { ...EMPTY_PLAYBOOK_LEARNING, ...(pb.learning ?? {}) };
  const head = [
    `trigger: ${pb.trigger}`, `keywords: ${pb.keywords.join(", ")}`,
    `created: ${pb.created}`, `last_used: ${pb.last_used}`,
    `uses: ${pb.uses}`, `stakes: ${pb.stakes}`,
    `version: ${pb.version ?? 1}`, `succ: ${pb.succ ?? 0}`, `fail: ${pb.fail ?? 0}`,
    `avg_secs: ${pb.avg_secs ?? 0}`,
    `learning_verified: ${learning.verified}`,
    `learning_partial: ${learning.partially_verified}`,
    `learning_unverified: ${learning.unverified}`,
    `learning_contradicted: ${learning.contradicted}`,
    `learning_failed: ${learning.failed}`,
    `learning_not_applicable: ${learning.not_applicable}`,
    `learning_last_task: ${learning.last_task_id}`,
    `learning_last_method: ${learning.last_method}`,
    `learning_last_at: ${learning.last_evidence_at}`,
    `learning_recent_tasks: ${learning.recent_task_ids.join(",")}`,
  ].join("\n");
  const steps = pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const lessonsSection = lessons.length
    ? `\n# Lessons\n${lessons.map((l) => `- ${l}`).join("\n")}`
    : "";
  return `---\n${head}\n---\n# Steps\n${steps}${lessonsSection}\n`;
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
  // Body = "# Steps" section, optionally followed by a "# Lessons" section.
  const body = m[2]!;
  const lessonsAt = body.indexOf("# Lessons");
  const stepsPart = lessonsAt >= 0 ? body.slice(0, lessonsAt) : body;
  const lessonsPart = lessonsAt >= 0 ? body.slice(lessonsAt) : "";
  const steps = stepsPart.split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "").trim())
    .filter((l) => l && l !== "# Steps");
  const lessons = lessonsPart.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter((l) => l && l !== "# Lessons");
  return {
    slug, trigger: head.trigger,
    keywords: (head.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
    created: head.created ?? "", last_used: head.last_used ?? "", uses: Number(head.uses ?? "0"),
    stakes: head.stakes === "consequential" ? "consequential" : "routine", steps,
    // v1 files predate these fields — default them so old playbooks stay valid.
    version: Number(head.version ?? "1") || 1,
    succ: Number(head.succ ?? "0") || 0,
    fail: Number(head.fail ?? "0") || 0,
    avg_secs: Number(head.avg_secs ?? "0") || 0,
    lessons,
    learning: {
      verified: Number(head.learning_verified ?? "0") || 0,
      partially_verified: Number(head.learning_partial ?? "0") || 0,
      unverified: Number(head.learning_unverified ?? "0") || 0,
      contradicted: Number(head.learning_contradicted ?? "0") || 0,
      failed: Number(head.learning_failed ?? "0") || 0,
      not_applicable: Number(head.learning_not_applicable ?? "0") || 0,
      last_task_id: head.learning_last_task ?? "",
      last_method: head.learning_last_method ?? "",
      last_evidence_at: Number(head.learning_last_at ?? "0") || 0,
      recent_task_ids: (head.learning_recent_tasks ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(-32),
    },
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
): { slug: string; trigger: string; keywords: string[]; uses: number; succ: number; fail: number;
  learning: PlaybookLearningStats }[] {
  // keywords + uses feed the local recall scorer (match.ts): keywords broaden
  // paraphrase matching, uses breaks ties toward the proven playbook.
  // succ/fail feed demotion — a playbook that keeps failing stops matching.
  return listPlaybooks(memoryDir).map((p) => ({
    slug: p.slug, trigger: p.trigger, keywords: p.keywords, uses: p.uses,
    succ: p.succ, fail: p.fail,
    learning: { ...EMPTY_PLAYBOOK_LEARNING, ...p.learning },
  }));
}
