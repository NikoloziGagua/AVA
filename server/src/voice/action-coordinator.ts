/**
 * One realtime connection may have at most one computer action.  Cancellation
 * advances the epoch and aborts the run; late promises from a retired epoch can
 * therefore never publish a result or restart speech.
 */
export interface VoiceActionRun {
  id: number;
  signal: AbortSignal;
}

export class VoiceActionCoordinator {
  private epoch = 0;
  private current: { id: number; controller: AbortController } | null = null;

  get active(): boolean {
    return this.current != null;
  }

  begin(): VoiceActionRun {
    this.cancel();
    const controller = new AbortController();
    const id = ++this.epoch;
    this.current = { id, controller };
    return { id, signal: controller.signal };
  }

  cancel(): boolean {
    const active = this.current;
    if (!active) return false;
    this.current = null;
    this.epoch += 1;
    active.controller.abort();
    return true;
  }

  isCurrent(id: number): boolean {
    return this.current?.id === id && !this.current.controller.signal.aborted;
  }

  finish(id: number): boolean {
    if (!this.isCurrent(id)) return false;
    this.current = null;
    return true;
  }
}
