import type { Db } from "../state/db.js";
import { getWatch } from "../state/watches.js";
import { listSubscriptions } from "../state/push.js";
import {
  beginReminderSend, claimDueReminders, deferReminder, emptyReminderCounts, finishReminder, finishUnsentReminder,
  type ReminderCounts, type ReminderReason,
} from "../state/reminders.js";

export type ReminderTransport = (request: { occurrenceId: string; summary: string; expiresAt: number }) => Promise<{
  subscriptions: ReminderCounts; reasonCode: ReminderReason | null;
}>;
export type ReminderDeps = {
  db: Db; deliverReminder?: ReminderTransport; now?: () => number;
  /** Test seam; production reads the existing subscription store. */
  subscriptionCount?: () => number;
  log?: { warn: (fields: unknown, message: string) => void };
  timeoutMs?: number;
};

/** Direct one-offs never wait behind agent/browser checks, and never call an LLM. */
export async function tickReminders(deps: ReminderDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const claims = claimDueReminders(deps.db, now());
  await Promise.all(claims.map(async (claim) => {
    const watch = getWatch(deps.db, claim.watch_id);
    if (!watch) return;
    if (!watch.enabled) { deferReminder(deps.db, claim, "paused", now()); return; }
    if (!deps.deliverReminder) { deferReminder(deps.db, claim, "push_not_configured", now()); return; }
    const count = deps.subscriptionCount?.() ?? listSubscriptions(deps.db).length;
    if (!Number.isSafeInteger(count) || count <= 0) { deferReminder(deps.db, claim, "no_subscriptions", now()); return; }
    const sending = beginReminderSend(deps.db, claim, now());
    if (!sending) return; // pause/delete/stale claim cannot cross the send boundary
    const boundedWait = Math.min(20_000, Math.max(1, deps.timeoutMs ?? 20_000), Math.max(1, sending.expires_at - now()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        deps.deliverReminder({ occurrenceId: claim.id, summary: watch.prompt.slice(0, 2000), expiresAt: sending.expires_at }),
        new Promise<Awaited<ReturnType<ReminderTransport>>>((resolve) => {
          timer = setTimeout(() => resolve({ subscriptions: { ...emptyReminderCounts(), total: count, unknown: count }, reasonCode: "transport_timeout" }), boundedWait);
        }),
      ]);
      if (result.reasonCode === "no_subscriptions" &&
        (["total", "accepted", "rejectedTransient", "rejectedPermanent", "unknown"] as const)
          .every((key) => result.subscriptions[key] === 0)) {
        finishUnsentReminder(deps.db, claim, sending, now());
      } else finishReminder(deps.db, sending, result, now());
    } catch {
      // Invocation entered but no safe acceptance/rejection evidence returned.
      // A race timeout is not cancellation; neither it nor a throw causes resend.
      finishReminder(deps.db, sending, { subscriptions: { ...emptyReminderCounts(), total: count, unknown: count }, reasonCode: "transport_unknown" }, now());
    } finally { if (timer) clearTimeout(timer); }
  }));
}
