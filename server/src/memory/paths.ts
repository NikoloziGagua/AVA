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

export function memoryPaths(dir: string): MemoryPaths {
  return {
    root: dir,
    personality: join(dir, "personality.md"),
    memoryIndex: join(dir, "MEMORY.md"),
    preferences: join(dir, "preferences.md"),
    observations: join(dir, "observations.md"),
    projectsDir: join(dir, "projects"),
    projectFile: (slug: string) => join(dir, "projects", `${slug}.md`),
  };
}
