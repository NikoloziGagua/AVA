import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { Deliverer, ReminderDeliveryResult } from "../push/deliver.js";
import { listSubscriptions } from "../state/push.js";
import { scrubSecrets } from "../security/scrub.js";
import { buildInitiativePrompt, initiativePushCopy, parseInitiativeReply } from "./prompt.js";
import { gatherSources } from "./sources.js";
import { getInitiativeSettings } from "./settings.js";
import { claimAttempt, endAttempt, fenced, getInitiative, initiativeView, publicationGate,
  publish, recentIdeas, retryAttempt, scopeOf, type InitiativeRow } from "./store.js";
import { occurrenceWindow } from "./time.js";

export type InitiativeEngineDeps = {
  db: Db; provider: Pick<LLMProvider, "complete" | "defaultSideModel"> | null;
  deliver?: Deliverer["deliverInitiativePush"];
  now?: () => number;
  /** Bounded reason codes only; never raw prompts, sources, replies or errors. */
  report?: (event: { id: string | null; state: string; reason: string | null }) => void;
};
function transportState(result: ReminderDeliveryResult) {
  const s = result.subscriptions;
  if (![s.total, s.accepted, s.rejectedTransient, s.rejectedPermanent, s.unknown].every(n => Number.isSafeInteger(n) && n >= 0)
    || s.total !== s.accepted + s.rejectedTransient + s.rejectedPermanent + s.unknown) return "unknown";
  return s.accepted > 0 ? "accepted" : s.total === 0 ? "no_subscription" : s.unknown > 0 ? "unknown" : "rejected";
}
export class InitiativeEngine {
  private now: () => number;
  private stopped = false;
  constructor(private deps: InitiativeEngineDeps) { this.now = deps.now ?? Date.now; }
  /** Stop new work and discard pending completions; no upstream abort is claimed. */
  stop(): void { this.stopped = true; }
  private report(row: InitiativeRow | null, state: string, reason: string | null = null) {
    this.deps.report?.({ id: row?.id ?? null, state, reason });
  }
  /** Passive tick. No session is created until a candidate passes publication. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const { db, provider } = this.deps;
    this.recover();
    await this.notifyPending();
    if (!provider) return;
    for (let round = 0; round < 2; round++) {
      if (this.stopped) return;
      const attempt = claimAttempt(db, this.now);
      if (!attempt) return;
      this.report(attempt, "generating");
      try {
        const gathered = gatherSources(db, getInitiativeSettings(db), this.now());
        if (!gathered) { endAttempt(db, attempt, this.now(), "suppressed", "no_eligible_scope"); return; }
        const prompt = buildInitiativePrompt({ now: this.now(), ...gathered,
          recentTitles: recentIdeas(db, gathered.scope, this.now()).slice(0, 20).map(row => scrubSecrets(row.title)) });
        if (!prompt) { endAttempt(db, attempt, this.now(), "suppressed", "no_grounded_idea"); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let raw: string;
        try {
          raw = await Promise.race([
            provider.complete({ model: provider.defaultSideModel, system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens }),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("initiative_lease_timeout")), Math.max(1, (attempt.lease_until ?? this.now()) - this.now())); }),
          ]);
        } finally { clearTimeout(timer); }
        if (this.stopped || !fenced(db, attempt, this.now())) return;
        const parsed = typeof raw === "string" && raw.length <= 16_000 ? parseInitiativeReply(raw, prompt) : { kind: "invalid" as const };
        if (parsed.kind !== "idea") {
          if (endAttempt(db, attempt, this.now(), parsed.kind === "none" ? "suppressed" : "failed",
            parsed.kind === "none" ? "no_grounded_idea" : "generation_failed")) {
            this.report(attempt, parsed.kind === "none" ? "suppressed" : "failed", parsed.kind === "none" ? "no_grounded_idea" : "generation_failed");
          }
          return;
        }
        let result: ReturnType<typeof publish>;
        try { result = publish(db, attempt, gathered.scope, parsed.candidate, this.now); }
        catch {
          if (endAttempt(db, attempt, this.now(), "failed", "publication_failed")) this.report(attempt, "failed", "publication_failed");
          return;
        }
        if (result === "published") { this.report(attempt, "published"); await this.notifyPending(); return; }
        if (result === "stale_source" || result === "duplicate") {
          if (retryAttempt(db, attempt, this.now())) continue;
          endAttempt(db, attempt, this.now(), "suppressed", result);
        }
        return;
      } catch {
        if (this.stopped) return;
        // A provider error never becomes terminal prose in a user's chat.
        if (fenced(db, attempt, this.now()) && retryAttempt(db, attempt, this.now())) continue;
        if (endAttempt(db, attempt, this.now(), "failed", "generation_failed")) this.report(attempt, "failed", "generation_failed");
        return;
      }
    }
  }
  recover(): void {
    const { db } = this.deps; const now = this.now();
    db.transaction(() => {
      // A bounded transport has finished by 20s. A receipt still sending after
      // 25s is uncertain (including a crash), never automatically resent.
      db.prepare(`UPDATE initiatives SET notification_state='unknown',notification_reason_code='interrupted',revision=revision+1
        WHERE notification_state='sending' AND notification_attempted_at<=?`).run(now - 25_000);
      const key = occurrenceWindow(now, getInitiativeSettings(db)).key;
      const expired = db.prepare(`SELECT * FROM initiatives WHERE state IN ('claimed','generating','generated','publishing')
        AND (lease_until IS NULL OR lease_until<=?)`).all(now) as InitiativeRow[];
      for (const row of expired) {
        const reason = publicationGate(db, now, row.occurrence_key);
        if (row.attempt_count < 2 && row.occurrence_key === key && !reason) continue;
        db.prepare(`UPDATE initiatives SET state=?,failure_reason=?,suppression_reason=?,revision=revision+1
          WHERE id=? AND revision=? AND (lease_until IS NULL OR lease_until<=?)`).run(row.attempt_count >= 2 ? "failed" : "suppressed",
            row.attempt_count >= 2 ? "generation_failed" : null, row.attempt_count >= 2 ? null : reason ?? "out_of_window", row.id, row.revision, now);
      }
    }).immediate();
  }
  async notifyPending(): Promise<void> {
    const { db } = this.deps;
    // A crash after publication but before claiming push is recoverable. Once
    // sending is claimed, uncertain delivery is never retried.
    const rows = db.prepare(`SELECT * FROM initiatives WHERE state='published' AND notification_state='none'
      AND expires_at>? ORDER BY published_at,id LIMIT 10`).all(this.now()) as InitiativeRow[];
    for (const row of rows) await this.notifyOne(row.id);
  }
  async notifyOne(id: string): Promise<void> {
    if (this.stopped) return;
    const { db, deliver } = this.deps;
    const claim = db.transaction(() => {
      const view = initiativeView(db, id); const row = getInitiative(db, id);
      if (!view || !row || row.notification_state !== "none" || view.expiresAt <= this.now()
        || view.disposition.state !== "open" || view.openedAt !== null) return null;
      const settings = getInitiativeSettings(db);
      if (!settings.enabled || publicationGate(db, this.now()) === "quiet_hours") return null;
      const session = db.prepare("SELECT last_human_activity_at, status FROM sessions WHERE id=?").get(view.sessionId) as { last_human_activity_at: number | null; status: string };
      if (session.last_human_activity_at !== null || session.status === "archived") return null;
      const scope = scopeOf(db, row)!;
      const message = db.prepare("SELECT content FROM messages WHERE id=? AND session_id=?").get(row.message_id, row.session_id) as { content: string };
      const token = nanoid(24);
      const won = db.prepare(`UPDATE initiatives SET notification_state='sending',notification_send_token=?,notification_attempted_at=?,revision=revision+1
        WHERE id=? AND notification_state='none'`).run(token, this.now(), id);
      return won.changes === 1 ? { token, view, copy: initiativePushCopy({ message: message.content }, scope) } : null;
    }).immediate();
    if (!claim) return;
    let state = "unknown"; let reason: string | null = "transport_unknown";
    try {
      if (!listSubscriptions(db).length) { state = "no_subscription"; reason = "no_subscriptions"; }
      else if (!deliver) { state = "rejected"; reason = "transport_unavailable"; }
      else {
        const result = await deliver({ initiativeId: id, sessionId: claim.view.sessionId,
          ...claim.copy, expiresAt: claim.view.expiresAt });
        state = transportState(result);
        reason = ["no_subscriptions", "transient_rejection", "permanent_rejection", "subscription_gone", "transport_timeout", "transport_unknown"].includes(result.reasonCode ?? "")
          ? result.reasonCode : null;
      }
    } catch { /* Unknown transport evidence, not a user-facing provider dump. */ }
    db.prepare(`UPDATE initiatives SET notification_state=?,notification_reason_code=?,revision=revision+1
      WHERE id=? AND notification_state='sending' AND notification_send_token=?`).run(state, reason, id, claim.token);
  }
}
