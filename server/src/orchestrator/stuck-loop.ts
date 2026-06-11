export const STUCK_WALLCLOCK_MS = 5 * 60_000;
export const LEVENSHTEIN_THRESHOLD = 50;
export const WINDOW_SIZE = 5;
export const MAX_COMPARE_CHARS = 4000;

const VISUAL_TOOLS = new Set(["chrome_read_page", "chrome_screenshot", "computer_use"]);

export type ToolObservation = { tool: string; resultText: string; at: number };

export type HaltDecision =
  | { halt: false }
  | { halt: true; reason: "wallclock" | "no-progress" };

export type StuckLoopState = {
  observe(obs: ToolObservation): HaltDecision;
  observeThought(text: string): void;
};

export function levenshtein(aIn: string, bIn: string): number {
  const a = aIn.length > MAX_COMPARE_CHARS ? aIn.slice(0, MAX_COMPARE_CHARS) : aIn;
  const b = bIn.length > MAX_COMPARE_CHARS ? bIn.slice(0, MAX_COMPARE_CHARS) : bIn;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      const sub = prev[j - 1]! + cost;
      let v = del < ins ? del : ins;
      if (sub < v) v = sub;
      curr[j] = v;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n]!;
}

export function createStuckLoop(opts?: {
  now?: () => number;
  wallclockMs?: number;
  windowSize?: number;
  threshold?: number;
}): StuckLoopState {
  const now = opts?.now ?? (() => Date.now());
  const wallclockMs = opts?.wallclockMs ?? STUCK_WALLCLOCK_MS;
  const windowSize = opts?.windowSize ?? WINDOW_SIZE;
  const threshold = opts?.threshold ?? LEVENSHTEIN_THRESHOLD;

  const startedAt = now();
  const window: ToolObservation[] = [];
  // Timestamp of the most recent non-empty thought we've observed.
  let lastThoughtAt: number | null = null;
  // The wallclock is a NO-PROGRESS clock, not a task budget. It used to halt on
  // the first tool result arriving >= 5 minutes after run START regardless of
  // progress — which cut off every long multi-phase task and contradicted the
  // 1000-turn "never cut off mid-work" design (a 6-minute claude_code edit
  // finished its work, then the run was killed before the model could report).
  // Now it measures time since the last sign of progress: a NOVEL tool result
  // (different from that tool's previous result) or any thought resets it.
  // Repeating identical results for `wallclockMs` still halts.
  let progressAt = startedAt;
  const lastResultByTool = new Map<string, string>();

  function observe(obs: ToolObservation): HaltDecision {
    const prev = lastResultByTool.get(obs.tool);
    const novel = prev === undefined || levenshtein(prev, obs.resultText) > threshold;
    lastResultByTool.set(obs.tool, obs.resultText);
    if (novel) progressAt = obs.at;
    if (obs.at - progressAt >= wallclockMs) {
      return { halt: true, reason: "wallclock" };
    }

    window.push(obs);
    while (window.length > windowSize) window.shift();

    if (window.length < windowSize) return { halt: false };

    // The window starts at window[0].at — a thought after this is "since window-start".
    const head = window[0];
    if (!head) return { halt: false };
    const windowStart = head.at;
    const thoughtSinceStart = lastThoughtAt !== null && lastThoughtAt >= windowStart;
    if (thoughtSinceStart) return { halt: false };

    // Collect visual-tool entries in window order.
    const visuals = window.filter((w) => VISUAL_TOOLS.has(w.tool));
    if (visuals.length === 0) return { halt: false };

    // Need at least one consecutive pair to evaluate similarity. With only one
    // visual entry and no thought we cannot conclude no-progress.
    if (visuals.length < 2) return { halt: false };

    for (let i = 1; i < visuals.length; i++) {
      const a = visuals[i - 1];
      const b = visuals[i];
      if (!a || !b) continue;
      const d = levenshtein(a.resultText, b.resultText);
      if (d > threshold) return { halt: false };
    }

    return { halt: true, reason: "no-progress" };
  }

  function observeThought(text: string): void {
    if (text && text.trim().length > 0) {
      lastThoughtAt = now();
      // Model reasoning/streamed text is progress — it keeps the no-progress
      // wallclock from aging out a long but actively-working run.
      progressAt = lastThoughtAt;
    }
  }

  return { observe, observeThought };
}
