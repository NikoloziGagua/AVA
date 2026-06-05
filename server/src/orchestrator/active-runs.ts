import type { SseBuffer } from "../sse/buffer.js";

export type ActiveRun = {
  sessionId: string;
  abort: AbortController;
  buffer: SseBuffer;
};

export class ActiveRuns {
  private runs = new Map<string, ActiveRun>();

  register(run: ActiveRun): void {
    this.runs.set(run.sessionId, run);
  }

  get(sessionId: string): ActiveRun | undefined {
    return this.runs.get(sessionId);
  }

  unregister(sessionId: string, run?: ActiveRun): void {
    // Identity-safe: if a newer run already owns this session's slot (e.g. a
    // preempting voice command started after this one was aborted), don't evict
    // it. Called with no `run` it force-frees the slot (used by kill/preempt).
    if (run && this.runs.get(sessionId) !== run) return;
    this.runs.delete(sessionId);
  }

  abort(sessionId: string): boolean {
    const r = this.runs.get(sessionId);
    if (!r) return false;
    r.abort.abort();
    return true;
  }
}
