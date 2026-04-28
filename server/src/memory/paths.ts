import { join } from "node:path";

export type MemoryPaths = {
  root: string;
  personality: string;
  memoryIndex: string;
  preferences: string;
  observations: string;
  projectsDir: string;
  projectFile: (slug: string) => string;
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function memoryPaths(dir: string): MemoryPaths {
  return {
    root: dir,
    personality: join(dir, "personality.md"),
    memoryIndex: join(dir, "MEMORY.md"),
    preferences: join(dir, "preferences.md"),
    observations: join(dir, "observations.md"),
    projectsDir: join(dir, "projects"),
    projectFile: (slug: string) => {
      if (!SLUG_RE.test(slug)) {
        throw new Error(`invalid project slug: ${slug}`);
      }
      return join(dir, "projects", `${slug}.md`);
    },
  };
}
