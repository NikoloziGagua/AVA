import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { Watch } from "./watches.js";

export const REMINDER_WINDOW_MS = 15 * 60_000;
export const REMINDER_LEASE_MS = 30_000;
export const REMINDER_MAX_ATTEMPTS = 3;
export type ReminderPhase = "scheduled" | "claimed" | "sending" | "retry_scheduled" | "accepted" | "failed" | "expired" | "acceptance_unknown" | "cancelled";
export type ReminderReason = "push_not_configured" | "no_subscriptions" | "transient_rejection" | "permanent_rejection" | "subscription_gone" | "transport_timeout" | "transport_unknown" | "missed_window" | "retry_exhausted" | "delivery_window_expired" | "paused" | "deleted" | "delivery_not_recorded";
export type ReminderCounts = { total: number; accepted: number; rejectedTransient: number; rejectedPermanent: number; unknown: number };
export type ReminderStatus = {
  version: 1; occurrenceId: string; revision: number;
  state: Exclude<ReminderPhase, "claimed" | "sending"> | "trying" | "paused";
  dueAt: number; timeZone: string | null; expiresAt: number; attempts: number;
  attemptedAt: number | null; nextAttemptAt: number | null; acceptedAt: number | null;
  subscriptions: ReminderCounts; reasonCode: ReminderReason | null; phoneReceipt: "unconfirmed";
};
export type ReminderOccurrence = {
  id: string; watch_id: string; due_at: number; time_zone: string | null; expires_at: number;
  revision: number; phase: ReminderPhase; lease_token: string | null; lease_until: number | null;
  attempts: number; last_attempt_at: number | null; next_attempt_at: number | null; accepted_at: number | null;
  total: number; accepted: number; rejected_transient: number; rejected_permanent: number; unknown: number;
  reason_code: ReminderReason | null;
};
const TERMINAL = new Set<ReminderPhase>(["accepted", "failed", "expired", "acceptance_unknown", "cancelled"]);
const REASONS = new Set<ReminderReason>(["push_not_configured", "no_subscriptions", "transient_rejection", "permanent_rejection", "subscription_gone", "transport_timeout", "transport_unknown", "missed_window", "retry_exhausted", "delivery_window_expired", "paused", "deleted", "delivery_not_recorded"]);
const safeReason = (reason: ReminderReason | null): ReminderReason | null => reason === null ? null : REASONS.has(reason) ? reason : "transport_unknown";
export const emptyReminderCounts = (): ReminderCounts => ({ total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 });

/** Safe inside the watch-creation transaction; stable identity makes replay inert. */
export function ensureReminderOccurrence(db: Db, watch: Pick<Watch, "id" | "kind" | "run_at" | "time_zone">): void {
  if (watch.kind !== "reminder" || watch.run_at === null) return;
  db.prepare(`INSERT OR IGNORE INTO reminder_occurrences
    (id,watch_id,due_at,time_zone,expires_at,phase,next_attempt_at) VALUES (?,?,?,?,?,'scheduled',?)`)
    .run(`reminder:${watch.id}:${watch.run_at}`, watch.id, watch.run_at, watch.time_zone, watch.run_at + REMINDER_WINDOW_MS, watch.run_at);
}

export function getReminderOccurrence(db: Db, id: string): ReminderOccurrence | null {
  return db.prepare("SELECT * FROM reminder_occurrences WHERE id = ?").get(id) as ReminderOccurrence | undefined ?? null;
}

export function getReminderStatus(db: Db, watch: Watch): ReminderStatus | undefined {
  if (watch.kind !== "reminder" || watch.run_at === null) return undefined;
  const row = db.prepare("SELECT * FROM reminder_occurrences WHERE watch_id = ? AND due_at = ?")
    .get(watch.id, watch.run_at) as ReminderOccurrence | undefined;
  if (!row) return undefined; // historical 'delivered' prose is not a receipt
  const paused = !watch.enabled && !TERMINAL.has(row.phase) && row.phase !== "sending";
  return {
    version: 1, occurrenceId: row.id, revision: row.revision,
    state: paused ? "paused" : row.phase === "claimed" || row.phase === "sending" ? "trying" : row.phase,
    dueAt: row.due_at, timeZone: row.time_zone, expiresAt: row.expires_at, attempts: row.attempts,
    attemptedAt: row.last_attempt_at, nextAttemptAt: paused ? null : row.next_attempt_at, acceptedAt: row.accepted_at,
    subscriptions: { total: row.total, accepted: row.accepted, rejectedTransient: row.rejected_transient, rejectedPermanent: row.rejected_permanent, unknown: row.unknown },
    reasonCode: paused ? "paused" : safeReason(row.reason_code), phoneReceipt: "unconfirmed",
  };
}

/** Bounded recovery/claim pass; an expired sending lease never permits resend. */
export function claimDueReminders(db: Db, now: number, limit = 8): ReminderOccurrence[] {
  return db.transaction(() => {
    // Upgrade only unattempted legacy one-offs; never infer old delivery evidence.
    const legacy = db.prepare(`SELECT w.* FROM watches w LEFT JOIN reminder_occurrences r
      ON r.watch_id=w.id AND r.due_at=w.run_at
      WHERE w.kind='reminder' AND w.run_at IS NOT NULL AND w.last_run_at IS NULL AND r.id IS NULL
      ORDER BY w.run_at LIMIT 64`).all() as Watch[];
    for (const watch of legacy) ensureReminderOccurrence(db, watch);
    db.prepare(`UPDATE reminder_occurrences SET phase='acceptance_unknown',reason_code='transport_unknown',
      revision=revision+1,lease_token=NULL,lease_until=NULL,next_attempt_at=NULL
      WHERE phase='sending' AND lease_until <= ?`).run(now);
    db.prepare(`UPDATE reminder_occurrences SET phase='scheduled',revision=revision+1,
      lease_token=NULL,lease_until=NULL,next_attempt_at=? WHERE phase='claimed' AND lease_until <= ?`).run(now, now);
    db.prepare(`UPDATE reminder_occurrences SET phase='expired',revision=revision+1,
      next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,
      reason_code=CASE WHEN attempts>0 THEN 'delivery_window_expired'
        WHEN reason_code IN ('push_not_configured','no_subscriptions') THEN reason_code ELSE 'missed_window' END
      WHERE phase IN ('scheduled','retry_scheduled','claimed') AND expires_at <= ?`).run(now);
    const due = db.prepare(`SELECT r.* FROM reminder_occurrences r JOIN watches w ON w.id=r.watch_id
      WHERE r.phase IN ('scheduled','retry_scheduled') AND r.next_attempt_at <= ?
        AND r.due_at <= ? AND r.expires_at > ? AND w.enabled=1
      ORDER BY r.next_attempt_at,r.id LIMIT ?`).all(now, now, now, Math.max(1, Math.min(16, limit))) as ReminderOccurrence[];
    return due.flatMap((row) => {
      const token = randomUUID();
      const updated = db.prepare(`UPDATE reminder_occurrences SET phase='claimed',revision=revision+1,
        lease_token=?,lease_until=? WHERE id=? AND revision=? AND phase IN ('scheduled','retry_scheduled')`)
        .run(token, now + REMINDER_LEASE_MS, row.id, row.revision);
      return updated.changes ? [getReminderOccurrence(db, row.id)!] : [];
    });
  }).immediate();
}

/** No asynchronous gap between this CAS and invoking transport in the runner. */
export function beginReminderSend(db: Db, claim: ReminderOccurrence, now: number): ReminderOccurrence | null {
  const changed = db.prepare(`UPDATE reminder_occurrences SET phase='sending',revision=revision+1,
    attempts=attempts+1,last_attempt_at=?,next_attempt_at=NULL,lease_until=?,
    total=0,accepted=0,rejected_transient=0,rejected_permanent=0,unknown=0,reason_code=NULL
    WHERE id=? AND revision=? AND lease_token=? AND phase='claimed' AND lease_until>?
      AND expires_at>? AND attempts<? AND EXISTS (SELECT 1 FROM watches w WHERE w.id=watch_id AND w.enabled=1)`)
    .run(now, now + REMINDER_LEASE_MS, claim.id, claim.revision, claim.lease_token, now, now, REMINDER_MAX_ATTEMPTS);
  return changed.changes ? getReminderOccurrence(db, claim.id) : null;
}

/** Configuration/subscription checks do not count as transmission attempts. */
export function deferReminder(db: Db, claim: ReminderOccurrence, reason: "push_not_configured" | "no_subscriptions" | "paused", now: number): void {
  db.prepare(`UPDATE reminder_occurrences SET phase='scheduled',revision=revision+1,reason_code=?,
    lease_token=NULL,lease_until=NULL,next_attempt_at=?
    WHERE id=? AND revision=? AND phase='claimed' AND lease_token=?`)
    .run(reason, Math.min(claim.expires_at, now + 15_000), claim.id, claim.revision, claim.lease_token);
}

export function finishReminder(db: Db, sending: ReminderOccurrence, result: {
  subscriptions: ReminderCounts; reasonCode: ReminderReason | null;
}, now: number): boolean {
  const c = result.subscriptions;
  const valid = Object.values(c).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    c.accepted + c.rejectedTransient + c.rejectedPermanent + c.unknown === c.total && c.total > 0;
  // Malformed transport values are uncertainty, never invented success.
  const counts = valid ? c : emptyReminderCounts();
  let phase: ReminderPhase;
  let reason = valid ? safeReason(result.reasonCode) : "transport_unknown" as ReminderReason;
  let next: number | null = null;
  if (!valid) { phase = "acceptance_unknown"; reason = "transport_unknown"; }
  else if (counts.accepted > 0) phase = "accepted";
  else if (counts.unknown > 0) { phase = "acceptance_unknown"; reason ??= "transport_unknown"; }
  else if (counts.rejectedTransient > 0 && now >= sending.expires_at) {
    phase = "expired"; reason = "delivery_window_expired";
  }
  else if (counts.rejectedTransient > 0 && sending.attempts < REMINDER_MAX_ATTEMPTS && now < sending.expires_at) {
    next = now + (sending.attempts === 1 ? 15_000 : 60_000);
    if (next >= sending.expires_at) { phase = "expired"; reason = "delivery_window_expired"; next = null; }
    else { phase = "retry_scheduled"; reason = "transient_rejection"; }
  } else { phase = "failed"; reason = counts.rejectedTransient > 0 ? "retry_exhausted" : reason ?? "permanent_rejection"; }
  return db.transaction(() => {
    const update = db.prepare(`UPDATE reminder_occurrences SET phase=?,revision=revision+1,reason_code=?,
      lease_token=NULL,lease_until=NULL,next_attempt_at=?,accepted_at=?,total=?,accepted=?,
      rejected_transient=?,rejected_permanent=?,unknown=?
      WHERE id=? AND revision=? AND phase='sending' AND lease_token=? AND lease_until>?`)
      .run(phase, reason, next, phase === "accepted" ? now : null, counts.total, counts.accepted,
        counts.rejectedTransient, counts.rejectedPermanent, counts.unknown,
        sending.id, sending.revision, sending.lease_token, now);
    if (!update.changes) return false;
    db.prepare(`UPDATE watches SET last_run_at=?,last_status=?,last_result=?,enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE id=?`)
      .run(now, phase === "accepted" ? "triggered" : "error",
        phase === "accepted" ? "notification service accepted; phone receipt unconfirmed" : `reminder ${phase}: ${reason}`,
        TERMINAL.has(phase) ? 1 : 0, sending.watch_id);
    return true;
  }).immediate();
}

/** A subscription disappearing between preflight and transport is not a send. */
export function finishUnsentReminder(db: Db, claim: ReminderOccurrence, sending: ReminderOccurrence, now: number): void {
  const expired = now >= sending.expires_at;
  db.prepare(`UPDATE reminder_occurrences SET phase=?,revision=revision+1,reason_code='no_subscriptions',
    lease_token=NULL,lease_until=NULL,next_attempt_at=?,attempts=?,last_attempt_at=?,
    total=?,accepted=?,rejected_transient=?,rejected_permanent=?,unknown=?
    WHERE id=? AND revision=? AND phase='sending' AND lease_token=? AND lease_until>?`)
    .run(expired ? "expired" : "scheduled", expired ? null : Math.min(sending.expires_at, now + 15_000),
      claim.attempts, claim.last_attempt_at, claim.total, claim.accepted, claim.rejected_transient,
      claim.rejected_permanent, claim.unknown, sending.id, sending.revision, sending.lease_token, now);
}
