import type { Response } from "express";
import type { SseEvent } from "./buffer.js";

export type SseSink = {
  write(ev: SseEvent): void;
  writeGap(from: number, oldestBuffered: number): void;
  close(): void;
  closed: boolean;
};

export function createSink(res: Response): SseSink {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  let closed = false;
  res.on("close", () => { closed = true; });

  return {
    get closed() { return closed; },
    write(ev) {
      if (closed) return;
      res.write(`id: ${ev.id}\n`);
      res.write(`event: ${ev.kind}\n`);
      res.write(`data: ${JSON.stringify(ev.payload)}\n\n`);
    },
    writeGap(from, oldestBuffered) {
      if (closed) return;
      const payload = { from, to: oldestBuffered - 1 };
      res.write(`event: gap\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}
