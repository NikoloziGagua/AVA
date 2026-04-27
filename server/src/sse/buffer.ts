export type SseEvent = {
  id: number;
  kind: string;
  payload: unknown;
  bytes: number;
  ts: number;
};

export type SinceResult = {
  gap: boolean;
  oldestBuffered: number | null;
  events: SseEvent[];
};

export class SseBuffer {
  private events: SseEvent[] = [];
  private nextId = 1;
  private totalBytes = 0;

  constructor(
    private readonly opts: { maxEvents: number; maxBytes: number }
  ) {}

  append(input: { kind: string; payload: unknown }): number {
    const serialized = JSON.stringify(input.payload);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const ev: SseEvent = {
      id: this.nextId++,
      kind: input.kind,
      payload: input.payload,
      bytes,
      ts: Date.now(),
    };
    this.events.push(ev);
    this.totalBytes += bytes;
    while (
      this.events.length > this.opts.maxEvents ||
      this.totalBytes > this.opts.maxBytes
    ) {
      const dropped = this.events.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.bytes;
    }
    return ev.id;
  }

  since(lastId: number): SinceResult {
    if (this.events.length === 0) {
      return { gap: false, oldestBuffered: null, events: [] };
    }
    const oldest = this.events[0]!.id;
    if (lastId + 1 < oldest) {
      return { gap: true, oldestBuffered: oldest, events: [...this.events] };
    }
    return {
      gap: false,
      oldestBuffered: oldest,
      events: this.events.filter((e) => e.id > lastId),
    };
  }

  size(): number {
    return this.events.length;
  }
}
