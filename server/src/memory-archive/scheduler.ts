import type { Db } from "../state/db.js";
import type { MemoryArchive } from "./archive.js";
import { MemoryExtractor, type ExtractionModel } from "./extractor.js";

type Log = { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

/**
 * Runs the background writer on Niko's conversations once they go quiet
 * (default five minutes), or sooner when a long conversation has piled up
 * unread messages. One conversation at a time, never during a voice reply's
 * critical path: it only reads what is already stored. Returns a stop function.
 */
export function startMemoryExtraction(opts: {
  db: Db;
  archive: MemoryArchive;
  model: ExtractionModel;
  log?: Log;
  idleMs?: number;
  backlog?: number;
  intervalMs?: number;
  now?: () => number;
}): { stop: () => void; tick: () => Promise<void> } {
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? 5 * 60_000;
  const backlog = opts.backlog ?? 40;
  const extractor = new MemoryExtractor(opts.db, opts.archive, opts.model, { origin: "conversation", actor: "extractor", now });
  const retryAfter = new Map<string, number>();
  let running = false;
  let controller: AbortController | null = null;

  const tick = async () => {
    if (running) return;
    running = true;
    controller = new AbortController();
    try {
      const pending = opts.db.prepare(`
        SELECT m.session_id AS id, COUNT(*) AS unread, MAX(m.created_at) AS last_at
        FROM messages m JOIN sessions s ON s.id = m.session_id
        LEFT JOIN memory_extraction_state x ON x.session_id = m.session_id
        WHERE s.deleted_at IS NULL AND s.origin IN ('human', 'unknown') AND m.role IN ('user', 'assistant')
          AND m.id > COALESCE(x.through_message_id, 0)
        GROUP BY m.session_id ORDER BY last_at
      `).all() as Array<{ id: string; unread: number; last_at: number }>;
      for (const session of pending) {
        if (controller.signal.aborted) break;
        if ((retryAfter.get(session.id) ?? 0) > now()) continue;
        if (now() - session.last_at < idleMs && session.unread < backlog) continue;
        try {
          // Batches without a line from Niko are marked read without a model call.
          const report = await extractor.extractSession(session.id, { maxBatches: 3, signal: controller.signal });
          if (report.applied.length) {
            opts.log?.info({ session: session.id, applied: report.applied.length, proposed: report.proposed }, "memory: learned from a conversation");
          }
        } catch (error) {
          // Back off this conversation; the batch that failed is retried later.
          retryAfter.set(session.id, now() + 10 * 60_000);
          opts.log?.warn({ session: session.id, err: error instanceof Error ? error.message : String(error) }, "memory: extraction failed");
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? 60_000);
  timer.unref?.();
  return {
    tick,
    stop: () => {
      clearInterval(timer);
      controller?.abort();
    },
  };
}
