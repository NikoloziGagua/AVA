import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { getSession, createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { getNoteFolder } from "../state/notes.js";
import { scrubSecrets } from "../security/scrub.js";
import { initiativeSourceKey, invitationText, type InitiativeCandidate, type InitiativeScope } from "./prompt.js";
import { SourceRefs, readSource } from "./sources.js";
import { getInitiativeSettings } from "./settings.js";
import { DAY, isQuiet, localDate, occurrenceWindow, resolveMinute } from "./time.js";
import { addLocalDays } from "../calendar/time.js";

export type InitiativeRow = {
  id: string; occurrence_key: string; scope_kind: "general" | "project"; scope_folder_id: string | null;
  sources: string; reason_now: string; title: string; state: "claimed" | "generating" | "generated" | "publishing" | "published" | "suppressed" | "failed";
  suppression_reason: string | null; failure_reason: string | null;
  attempt_count: number; attempt_token: string | null; lease_until: number | null;
  created_at: number; published_at: number | null; expires_at: number | null;
  session_id: string | null; message_id: number | null;
  notification_state: "none" | "sending" | "accepted" | "rejected" | "unknown" | "no_subscription";
  notification_send_token: string | null; notification_attempted_at: number | null; notification_reason_code: string | null;
  opened_at: number | null; disposition_state: "open" | "later" | "not_useful" | "engaged";
  disposition_version: number; disposition_updated_at: number; revision: number;
};
export const LEASE_MS = 120_000;
export function getInitiative(db: Db, id: string): InitiativeRow | null {
  return db.prepare("SELECT * FROM initiatives WHERE id=?").get(id) as InitiativeRow ?? null;
}
export function scopeOf(db: Db, row: InitiativeRow): InitiativeScope | null {
  if (row.scope_kind === "general" && row.scope_folder_id === null) return { kind: "general" };
  const folder = row.scope_folder_id && getNoteFolder(db, row.scope_folder_id);
  return folder ? { kind: "project", folderId: folder.id, name: scrubSecrets(folder.name),
    active: getInitiativeSettings(db).activeProjectFolderIds.includes(folder.id) } : null;
}
export function disposition(row: InitiativeRow) {
  return { state: row.disposition_state, version: row.disposition_version, updatedAt: row.disposition_updated_at };
}
export function initiativeView(db: Db, id: string) {
  if (!/^ini_[A-Za-z0-9_-]{1,124}$/.test(id)) return null;
  const row = getInitiative(db, id);
  if (!row || row.state !== "published" || !row.session_id || row.published_at === null || row.expires_at === null) return null;
  const session = getSession(db, row.session_id);
  if (!session || session.origin !== "assistant" || session.initiativeId !== id) return null;
  const scope = scopeOf(db, row);
  let refs;
  try { refs = SourceRefs.safeParse(JSON.parse(row.sources)); } catch { return null; }
  if (!scope || !refs.success) return null;
  const settings = getInitiativeSettings(db);
  return { id, sessionId: row.session_id, title: scrubSecrets(row.title), reasonNow: scrubSecrets(row.reason_now),
    scope: scope.kind === "general" ? scope : { kind: "project" as const, folderId: scope.folderId, name: scope.name },
    publishedAt: row.published_at, expiresAt: row.expires_at, openedAt: row.opened_at,
    disposition: disposition(row), notification: { state: row.notification_state },
    sources: refs.data.map(ref => readSource(db, ref, scope, settings)) };
}
export function inboxSummary(db: Db, now = Date.now()) {
  const rows = db.prepare(`SELECT i.id FROM initiatives i JOIN sessions s ON s.id=i.session_id
    JOIN messages m ON m.id=i.message_id AND m.session_id=s.id AND m.role='assistant'
    WHERE i.state='published' AND i.expires_at>? AND i.disposition_state IN ('open','later')
      AND s.origin='assistant' AND s.last_human_activity_at IS NULL AND s.deleted_at IS NULL AND s.status!='archived'
    ORDER BY i.published_at DESC,s.id DESC`).all(now) as { id: string }[];
  const views = rows.map(row => initiativeView(db, row.id)).filter(v => v !== null);
  const newest = views[0];
  return { pending: views.length, unopened: views.filter(v => v.openedAt === null).length,
    newest: newest ? { initiativeId: newest.id, sessionId: newest.sessionId, title: newest.title, publishedAt: newest.publishedAt } : null };
}
export function markOpened(db: Db, id: string, now = Date.now()): boolean {
  return db.transaction(() => {
    if (!initiativeView(db, id)) return false;
    db.prepare("UPDATE initiatives SET opened_at=?,revision=revision+1 WHERE id=? AND opened_at IS NULL").run(now, id);
    return true;
  }).immediate();
}
export function setDisposition(db: Db, id: string, state: "later" | "not_useful", version: number, now = Date.now()) {
  return db.transaction(() => {
    if (!initiativeView(db, id)) return null;
    const row = getInitiative(db, id)!;
    if (row.disposition_version !== version || row.disposition_state === "engaged") return { ok: false as const, disposition: disposition(row) };
    // An exact replay of the current decision is a no-op, not a new observation.
    if (row.disposition_state !== state) db.prepare(`UPDATE initiatives SET disposition_state=?,disposition_version=disposition_version+1,
      disposition_updated_at=?,revision=revision+1 WHERE id=? AND disposition_version=?`).run(state, now, id, version);
    return { ok: true as const, disposition: disposition(getInitiative(db, id)!) };
  }).immediate();
}
export function publicationGate(db: Db, now: number, key?: string): string | null {
  const settings = getInitiativeSettings(db);
  if (!settings.enabled) return "disabled";
  if (isQuiet(now, settings)) return "quiet_hours";
  const window = occurrenceWindow(now, settings);
  if (!window.eligible || key && key !== window.key) return "out_of_window";
  const date = localDate(now);
  if (db.prepare("SELECT 1 FROM initiatives WHERE state='published' AND published_at>=? AND published_at<? LIMIT 1")
    .get(resolveMinute(date, "00:00"), resolveMinute(addLocalDays(date, 1), "00:00"))) return "budget";
  return null;
}
/** Own a new generation attempt; SQLite serializes concurrent processes. */
export function claimAttempt(db: Db, at: number | (() => number)): InitiativeRow | null {
  return db.transaction(() => {
    const now = typeof at === "function" ? at() : at;
    if (publicationGate(db, now)) return null;
    const key = occurrenceWindow(now, getInitiativeSettings(db)).key;
    let row = db.prepare("SELECT * FROM initiatives WHERE occurrence_key=?").get(key) as InitiativeRow | undefined;
    if (row && (["published", "suppressed", "failed"].includes(row.state) || (row.lease_until ?? 0) > now)) return null;
    if (row && row.attempt_count >= 2) {
      db.prepare("UPDATE initiatives SET state='failed',failure_reason='generation_failed',revision=revision+1 WHERE id=? AND revision=?")
        .run(row.id, row.revision);
      return null;
    }
    if (!row) {
      const id = `ini_${nanoid(16)}`;
      db.prepare(`INSERT INTO initiatives(id,occurrence_key,scope_kind,state,created_at,disposition_updated_at)
        VALUES (?,?,'general','claimed',?,?)`).run(id, key, now, now);
      row = getInitiative(db, id)!;
    }
    db.prepare(`UPDATE initiatives SET state='generating',attempt_count=attempt_count+1,
      attempt_token=?,lease_until=?,revision=revision+1 WHERE id=? AND revision=?`)
      .run(nanoid(24), now + LEASE_MS, row.id, row.revision);
    return getInitiative(db, row.id);
  }).immediate();
}
export function fenced(db: Db, attempt: InitiativeRow, now: number): boolean {
  const row = getInitiative(db, attempt.id);
  return !!row && row.state === attempt.state && row.revision === attempt.revision
    && row.attempt_token === attempt.attempt_token && (row.lease_until ?? 0) > now;
}
export function endAttempt(db: Db, attempt: InitiativeRow, now: number, state: "suppressed" | "failed", reason: string): boolean {
  const column = state === "suppressed" ? "suppression_reason" : "failure_reason";
  return db.prepare(`UPDATE initiatives SET state=?,${column}=?,revision=revision+1
    WHERE id=? AND state=? AND revision=? AND attempt_token=? AND lease_until>?`)
    .run(state, reason, attempt.id, attempt.state, attempt.revision, attempt.attempt_token, now).changes === 1;
}
export function recentIdeas(db: Db, scope: InitiativeScope, now: number) {
  // Feedback belongs to this exact scope, not a global preference. Rejection
  // age starts when Niko made the decision, never when the idea was published.
  return db.prepare(`SELECT * FROM initiatives WHERE state='published'
    AND (published_at>=? OR (disposition_state='not_useful' AND disposition_updated_at>=?))
    AND scope_kind=? AND scope_folder_id IS ?
    ORDER BY CASE WHEN disposition_state='not_useful' THEN MAX(published_at,disposition_updated_at)
      ELSE published_at END DESC,id DESC LIMIT 200`)
    .all(now - 14 * DAY, now - 30 * DAY, scope.kind, scope.kind === "project" ? scope.folderId : null) as InitiativeRow[];
}
export function duplicateIdea(rows: InitiativeRow[], candidate: InitiativeCandidate): boolean {
  const key = (refs: InitiativeCandidate["sources"]) => refs.map(initiativeSourceKey).sort().join("|");
  const title = candidate.title.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return rows.some(row => row.title.toLocaleLowerCase().replace(/\s+/g, " ").trim() === title
    || key(SourceRefs.parse(JSON.parse(row.sources))) === key(candidate.sources));
}
export function publish(db: Db, attempt: InitiativeRow, scope: InitiativeScope, candidate: InitiativeCandidate, at: number | (() => number)) {
  return db.transaction(() => {
    const now = typeof at === "function" ? at() : at;
    if (!fenced(db, attempt, now)) return "discarded" as const;
    const gate = publicationGate(db, now, attempt.occurrence_key);
    if (gate) { endAttempt(db, attempt, now, "suppressed", gate); return "suppressed" as const; }
    const settings = getInitiativeSettings(db);
    if (scope.kind === "project" && (!getNoteFolder(db, scope.folderId)
      || scope.active !== settings.activeProjectFolderIds.includes(scope.folderId))) return "stale_source" as const;
    if (candidate.sources.some(ref => readSource(db, ref, scope, settings).status !== "current")) return "stale_source" as const;
    if (duplicateIdea(recentIdeas(db, scope, now), candidate)) return "duplicate" as const;
    // Intermediate states and publication share a transaction: no orphan
    // conversation, and no generated transcript copied into the receipt.
    for (const state of ["generated", "publishing"] as const) {
      const result = db.prepare(`UPDATE initiatives SET state=?,revision=revision+1 WHERE id=? AND state=?
        AND revision=? AND attempt_token=? AND lease_until>?`)
        .run(state, attempt.id, attempt.state, attempt.revision, attempt.attempt_token, now);
      if (result.changes !== 1) throw new Error("initiative_fence_lost");
      attempt = { ...attempt, state, revision: attempt.revision + 1 };
    }
    const session = createSession(db, { origin: "assistant", title: scrubSecrets(candidate.title) });
    const message = appendMessage(db, { sessionId: session.id, role: "assistant", content: scrubSecrets(invitationText(candidate)) });
    const result = db.prepare(`UPDATE initiatives SET state='published',scope_kind=?,scope_folder_id=?,sources=?,reason_now=?,title=?,
      published_at=?,expires_at=?,session_id=?,message_id=?,revision=revision+1 WHERE id=? AND state='publishing'
      AND attempt_token=? AND revision=? AND lease_until>?`).run(scope.kind, scope.kind === "project" ? scope.folderId : null,
        JSON.stringify(candidate.sources), scrubSecrets(candidate.reasonNow), scrubSecrets(candidate.title), now, now + 3 * DAY,
        session.id, message.id, attempt.id, attempt.attempt_token, attempt.revision, now);
    if (result.changes !== 1) throw new Error("initiative_fence_lost");
    return "published" as const;
  }).immediate();
}
export function retryAttempt(db: Db, attempt: InitiativeRow, now: number): boolean {
  // Release this attempt only while it still owns the live lease. The next
  // claim increments both token and revision before another provider call.
  return db.prepare(`UPDATE initiatives SET lease_until=?,revision=revision+1 WHERE id=? AND state=?
    AND revision=? AND attempt_token=? AND lease_until>? AND attempt_count<2`)
    .run(now, attempt.id, attempt.state, attempt.revision, attempt.attempt_token, now).changes === 1;
}
