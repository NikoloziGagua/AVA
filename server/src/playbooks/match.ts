// Local, instant playbook recall. This used to be a side-model LLM call awaited
// before EVERY typed action turn — measured live at 1.7-2.8s of pre-roll per
// message (and ~2k side-model tokens each time). Token-overlap scoring against
// each playbook's trigger + keywords is ~0ms and free. Precision is protected
// by a strict threshold: a wrong playbook injection steers the whole run, so
// "no match" is always preferred over a loose one.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "my", "me", "sir", "please", "can", "you", "your", "into", "from", "that",
  "this", "it", "is", "are", "do", "does", "all", "any", "what", "how",
]);

/** Distinct lowercase tokens ≥3 chars, stopwords dropped. */
export function tokenize(s: string): string[] {
  return [...new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )];
}

export type PlaybookIndexEntry = {
  slug: string;
  trigger: string;
  keywords?: string[];
  uses?: number;
  succ?: number;
  fail?: number;
};

/** A playbook that keeps failing when recalled stops being offered. */
export function isDemoted(e: { succ?: number; fail?: number }): boolean {
  const succ = e.succ ?? 0;
  const fail = e.fail ?? 0;
  return fail >= 3 && fail > succ;
}

export function matchPlaybook(o: { prompt: string; index: PlaybookIndexEntry[] }): string | null {
  if (o.index.length === 0) return null;
  const prompt = new Set(tokenize(o.prompt));
  if (prompt.size === 0) return null;

  let best: { slug: string; score: number; uses: number } | null = null;
  for (const e of o.index) {
    if (isDemoted(e)) continue;
    const trig = tokenize(e.trigger);
    if (trig.length === 0) continue;
    const kw = tokenize((e.keywords ?? []).join(" "));
    const trigHits = trig.filter((t) => prompt.has(t)).length;
    // At least two distinct trigger tokens must appear (or the whole trigger
    // when it's a single-token one) — keywords alone can never match.
    if (trigHits < Math.min(2, trig.length)) continue;
    const coverage = trigHits / trig.length;
    const kwHits = kw.filter((t) => prompt.has(t)).length;
    // Accept on strong trigger coverage, OR on decent coverage backed by
    // keyword corroboration. Distill now produces short (≤8-word) canonical
    // triggers, so paraphrases reach 0.6 far more often than under v1; the
    // keyword path catches the rest without letting keywords alone steer.
    const accepted = coverage >= 0.6 || (coverage >= 0.4 && kwHits >= 2);
    if (!accepted) continue;
    const score = coverage + 0.1 * Math.min(kwHits, 5);
    const uses = e.uses ?? 0;
    if (!best || score > best.score || (score === best.score && uses > best.uses)) {
      best = { slug: e.slug, score, uses };
    }
  }
  return best?.slug ?? null;
}
