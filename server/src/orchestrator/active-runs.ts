import type { SseBuffer } from "../sse/buffer.js";

export type ActiveRun = {
  sessionId: string;
  /** The run's id (nanoid). Lets the kill endpoint find this run's child PIDs
   *  in the PidfileRegistry so it can kill the whole subtree on Stop. */
  runId: string;
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

  /** The runId of the run currently holding this session's slot, or null. The
   *  kill endpoint uses it to look up the run's child PIDs and kill the tree. */
  getRunId(sessionId: string): string | null {
    return this.runs.get(sessionId)?.runId ?? null;
  }

  /** Snapshot the process-local runs that are genuinely active right now.
   * Explorer uses this instead of treating stale database rows as live work. */
  list(): ActiveRun[] {
    return [...this.runs.values()];
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
