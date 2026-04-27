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

  unregister(sessionId: string): void {
    this.runs.delete(sessionId);
  }

  abort(sessionId: string): boolean {
    const r = this.runs.get(sessionId);
    if (!r) return false;
    r.abort.abort();
    return true;
  }
}
