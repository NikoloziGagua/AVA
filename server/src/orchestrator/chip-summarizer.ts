import type { Db } from "../state/db.js";
import type { LLMProvider } from "./llm/types.js";
import {
  getCachedLabel, setCachedLabel, hashPrompt,
} from "../state/chip-label-cache.js";

const TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM = `You write short imperative chip labels for a smart-home assistant.
Output JSON: {"labels":[{"id":"...","label":"..."}, ...]}.
Each label ≤ 6 words, imperative, no trailing punctuation, sentence case.`;

export type SummarizerInput = { id: string; prompt: string };
export type SummarizerOutput = { id: string; label: string };

export type SummarizerDeps = {
  db: Db;
  deviceId: string;
  provider: LLMProvider;
  nowMs: number;
};

export async function summarizeChips(
  raws: SummarizerInput[],
  deps: SummarizerDeps,
): Promise<SummarizerOutput[]> {
  const out: SummarizerOutput[] = new Array(raws.length);
  const misses: { idx: number; raw: SummarizerInput; hash: string }[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!;
    const hash = hashPrompt(raw.prompt);
    const hit = getCachedLabel(deps.db, deps.deviceId, hash, deps.nowMs);
    if (hit) {
      out[i] = { id: raw.id, label: hit };
    } else {
      misses.push({ idx: i, raw, hash });
    }
  }

  if (misses.length === 0) return out;

  let parsed: { labels?: { id: string; label: string }[] } = {};
  try {
    const completion = await deps.provider.complete({
      model: deps.provider.defaultSideModel,
      system: SYSTEM,
      user: JSON.stringify(misses.map((m) => ({ id: m.raw.id, prompt: m.raw.prompt }))),
      maxTokens: 256,
    });
    parsed = JSON.parse(completion);
  } catch { parsed = {}; }

  const byId = new Map<string, string>();
  for (const r of parsed.labels ?? []) {
    if (typeof r?.id === "string" && typeof r?.label === "string") {
      byId.set(r.id, r.label.trim());
    }
  }

  const expiresAt = deps.nowMs + TTL_MS;
  for (const m of misses) {
    const label = byId.get(m.raw.id) ?? fallback(m.raw.prompt);
    out[m.idx] = { id: m.raw.id, label };
    setCachedLabel(deps.db, deps.deviceId, m.hash, label, expiresAt);
  }
  return out;
}

function fallback(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 32) return capitalize(trimmed);
  return capitalize(trimmed.slice(0, 32)) + "…";
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
