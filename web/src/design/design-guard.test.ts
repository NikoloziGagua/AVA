import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Design guard (contract ui-remodel v1 §1). A ratchet, not a blanket switch:
 * - web/src/design/** (except tokens.css) and every file listed in `migrated`
 *   must have zero violations;
 * - every other file may not exceed its committed baseline count.
 * Regenerate after a real reduction with: UPDATE_DESIGN_BASELINE=1 npx vitest run src/design/design-guard
 */

// jsdom gives import.meta.url an http URL, so resolve from the working directory (web/ or the repo root).
const SRC = existsSync(join(process.cwd(), "src", "design")) ? join(process.cwd(), "src") : join(process.cwd(), "web", "src");
const BASELINE_PATH = join(SRC, "design", "design-guard.baseline.json");

type Counts = { tinyText: number; rawColour: number; backdrop: number };
type Baseline = { migrated: string[]; files: Record<string, Counts> };

const RULES: Record<keyof Counts, RegExp[]> = {
  // Text under 12px, as Tailwind arbitrary sizes, CSS or inline style numbers.
  tinyText: [
    /text-\[(?:\d|1[01])(?:\.\d+)?px\]/g,
    /font-size:\s*(?:\d|1[01])(?:\.\d+)?px/g,
    /fontSize:\s*["']?(?:\d|1[01])(?:\.\d+)?(?:px)?["']?\s*[,}]/g,
  ],
  // Raw colours belong in design/tokens.css only.
  rawColour: [
    /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b(?![-\w])/g,
    /\brgba?\(/g,
    /\bhsla?\(/g,
  ],
  // Blur is applied only through the .ds-glass utility on resting elements.
  backdrop: [/backdrop-blur/g, /backdrop-filter/g, /backdropFilter/g],
};

const EXEMPT = new Set(["design/tokens.css"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/test-helper/.test(name)) out.push(full);
  }
  return out;
}

function count(text: string): Counts {
  const result: Counts = { tinyText: 0, rawColour: 0, backdrop: 0 };
  for (const key of Object.keys(RULES) as (keyof Counts)[]) {
    for (const pattern of RULES[key]) result[key] += (text.match(pattern) ?? []).length;
  }
  return result;
}

function scan(): Record<string, Counts> {
  const files: Record<string, Counts> = {};
  for (const full of walk(SRC)) {
    const rel = relative(SRC, full).split(sep).join("/");
    if (EXEMPT.has(rel)) continue;
    const counts = count(readFileSync(full, "utf8"));
    if (counts.tinyText || counts.rawColour || counts.backdrop) files[rel] = counts;
  }
  return files;
}

const strict = (rel: string, baseline: Baseline) => rel.startsWith("design/") || baseline.migrated.includes(rel);

describe("design guard", () => {
  const actual = scan();
  const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  if (process.env.UPDATE_DESIGN_BASELINE === "1") {
    const files = Object.fromEntries(Object.entries(actual)
      .filter(([rel]) => !strict(rel, baseline))
      .sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ migrated: baseline.migrated, files }, null, 2)}\n`);
  }

  it("keeps the design system and migrated screens completely clean", () => {
    const dirty = Object.entries(actual).filter(([rel]) => strict(rel, baseline));
    expect(dirty).toEqual([]);
  });

  it("never lets a legacy file get worse than its baseline", () => {
    const worse: string[] = [];
    for (const [rel, counts] of Object.entries(actual)) {
      if (strict(rel, baseline)) continue;
      const base = baseline.files[rel] ?? { tinyText: 0, rawColour: 0, backdrop: 0 };
      for (const key of Object.keys(counts) as (keyof Counts)[]) {
        if (counts[key] > base[key]) worse.push(`${rel}: ${key} ${counts[key]} > baseline ${base[key]}`);
      }
    }
    expect(worse).toEqual([]);
  });

  it("detects the violations it is meant to catch", () => {
    expect(count(`<p className="text-[10px] text-white/30">x</p>`).tinyText).toBe(1);
    expect(count(`<p className="text-[12px]">x</p>`).tinyText).toBe(0);
    expect(count(`const c = "#5cf2ff"; const d = "rgba(0,0,0,.5)";`).rawColour).toBe(2);
    expect(count(`<a href="#top">`).rawColour).toBe(0);
    expect(count(`style={{ fontSize: 10, color: "red" }}`).tinyText).toBe(1);
    expect(count(`className="backdrop-blur-xl"`).backdrop).toBe(1);
  });
});
