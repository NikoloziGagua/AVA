import { memoryPaths } from "./paths.js";
import { appendLine, readFile } from "./store.js";

export type ProjectEntry = {
  slug: string;
  /** Absolute path roots associated with this project (forward-slashed, lowercase). */
  roots: string[];
};

const PROJECT_LINK_RE = /\bprojects\/([a-z0-9][a-z0-9_-]*)\.md\b/gi;
const PATH_RE = /(?:^|\s|["'`(<])((?:[A-Za-z]:[\\/]|\/)[^\s"'`)>]+)/g;

function normalize(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

/**
 * Ensure a project written through memory_remember is discoverable on later
 * turns. Previously the tool created projects/<slug>.md but nothing in runtime
 * could create MEMORY.md, so loadProjectIndex() could never see that project.
 */
export function ensureProjectIndexed(memoryDir: string, slug: string): void {
  const p = memoryPaths(memoryDir);
  // Validates the slug before it is rendered into Markdown.
  p.projectFile(slug);
  const canonicalSlug = slug.toLowerCase();
  const current = readFile(p.memoryIndex);
  for (const match of current.matchAll(PROJECT_LINK_RE)) {
    if (match[1]?.toLowerCase() === canonicalSlug) return;
  }
  appendLine(p.memoryIndex, `- [${slug}](projects/${slug}.md)`);
}

/** Build the project index by scanning MEMORY.md and each linked project file. */
export function loadProjectIndex(memoryDir: string): ProjectEntry[] {
  const p = memoryPaths(memoryDir);
  const memoryIndex = readFile(p.memoryIndex);
  if (!memoryIndex) return [];

  const slugs = new Set<string>();
  for (const m of memoryIndex.matchAll(PROJECT_LINK_RE)) {
    slugs.add(m[1]!.toLowerCase());
  }

  const entries: ProjectEntry[] = [];
  for (const slug of slugs) {
    let body: string;
    try {
      body = readFile(p.projectFile(slug));
    } catch {
      continue; // invalid slug — skip
    }
    if (!body) continue;
    const roots = new Set<string>();
    for (const m of body.matchAll(PATH_RE)) {
      roots.add(normalize(m[1]!));
    }
    if (roots.size > 0) entries.push({ slug, roots: [...roots] });
  }
  return entries;
}

/**
 * Find the longest-matching project by scanning the candidate text for any of
 * the project roots. Returns null when no project matches. Case-insensitive.
 */
export function detectProject(
  text: string,
  index: ProjectEntry[],
): ProjectEntry | null {
  if (!text || index.length === 0) return null;
  const haystack = text.replace(/\\/g, "/").toLowerCase();
  let best: { entry: ProjectEntry; len: number } | null = null;
  for (const e of index) {
    for (const root of e.roots) {
      if (root && haystack.includes(root)) {
        if (!best || root.length > best.len) {
          best = { entry: e, len: root.length };
        }
      }
    }
  }
  return best?.entry ?? null;
}

/** Read the project file body for use as projectContext in the system prompt. */
export function readProjectFile(memoryDir: string, slug: string): string {
  const p = memoryPaths(memoryDir);
  try {
    return readFile(p.projectFile(slug));
  } catch {
    return "";
  }
}
