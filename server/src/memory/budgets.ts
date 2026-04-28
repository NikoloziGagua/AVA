import { parseObservation } from "./observations.js";

export const SOFT_CAPS = {
  personality: 500,
  memoryIndex: 500,
  preferences: 1000,
  observations: 2000,
  project: 2000,
} as const;

export const HARD_CAPS = {
  personality: 1000,
  memoryIndex: 1000,
  preferences: 2000,
  observations: 4000,
  project: 4000,
} as const;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

const STALE_DAYS = 60;
const MS_PER_DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.floor(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY,
  );
}

export type PruneResult = {
  content: string;
  action: "none" | "dropped_superseded" | "dropped_stale_low" | "needs_user";
};

export function autoPruneObservations(
  fileContent: string,
  opts: { today: string; softCap: number },
): PruneResult {
  if (estimateTokens(fileContent) <= opts.softCap) {
    return { content: fileContent, action: "none" };
  }

  const lines = fileContent.split("\n");

  // Pass 1: drop superseded lines
  const noSuperseded = lines.filter((ln) => {
    const o = parseObservation(ln);
    return !o || !o.superseded;
  });
  const afterPass1 = noSuperseded.join("\n");
  if (afterPass1 !== fileContent) {
    if (estimateTokens(afterPass1) <= opts.softCap) {
      return { content: afterPass1, action: "dropped_superseded" };
    }
    // Still over after dropping superseded — continue to pass 2 with pruned content
    const noStaleLow2 = noSuperseded.filter((ln) => {
      const o = parseObservation(ln);
      if (!o) return true;
      if (o.confidence !== "low") return true;
      return daysBetween(o.date, opts.today) <= STALE_DAYS;
    });
    const afterPass2 = noStaleLow2.join("\n");
    if (afterPass2 !== afterPass1) {
      return { content: afterPass2, action: "dropped_stale_low" };
    }
    return { content: afterPass1, action: "dropped_superseded" };
  }

  // Pass 2: drop low-confidence stale lines
  const noStaleLow = lines.filter((ln) => {
    const o = parseObservation(ln);
    if (!o) return true;
    if (o.confidence !== "low") return true;
    return daysBetween(o.date, opts.today) <= STALE_DAYS;
  });
  const afterStaleLow = noStaleLow.join("\n");
  if (afterStaleLow !== fileContent) {
    return { content: afterStaleLow, action: "dropped_stale_low" };
  }

  return { content: fileContent, action: "needs_user" };
}
