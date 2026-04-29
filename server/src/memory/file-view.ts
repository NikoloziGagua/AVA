import { existsSync, readdirSync } from "node:fs";
import { memoryPaths } from "./paths.js";
import { readFile } from "./store.js";
import { parseObservation } from "./observations.js";

export type ObsLine = {
  raw: string;
  date: string;
  confidence: "low" | "medium" | "high";
  category: string;
  text: string;
  superseded: string | null;
};

export type MemoryView = {
  personality: string;
  memoryIndex: string;
  preferences: { lines: string[] };
  observations: { lines: ObsLine[] };
  projects: Array<{ slug: string; body: string }>;
};

const PROJECT_SLUG_RE = /^([a-z0-9][a-z0-9_-]*)\.md$/i;

export function readMemoryView(dir: string): MemoryView {
  const p = memoryPaths(dir);
  const prefRaw = readFile(p.preferences);
  const obsRaw = readFile(p.observations);

  const projects: Array<{ slug: string; body: string }> = [];
  if (existsSync(p.projectsDir)) {
    for (const name of readdirSync(p.projectsDir).sort()) {
      const m = PROJECT_SLUG_RE.exec(name);
      if (!m) continue;
      const slug = m[1]!;
      projects.push({ slug, body: readFile(p.projectFile(slug)) });
    }
  }

  return {
    personality: readFile(p.personality),
    memoryIndex: readFile(p.memoryIndex),
    preferences: {
      lines: prefRaw.split("\n").filter((l) => l.trim().length > 0),
    },
    observations: {
      lines: obsRaw
        .split("\n")
        .map((raw) => {
          const o = parseObservation(raw);
          if (!o) return null;
          return {
            raw, date: o.date, confidence: o.confidence,
            category: o.category, text: o.text, superseded: o.superseded,
          } satisfies ObsLine;
        })
        .filter((x): x is ObsLine => x !== null),
    },
    projects,
  };
}
