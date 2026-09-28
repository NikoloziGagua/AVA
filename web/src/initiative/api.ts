import { ApiError, request, type SessionRow } from "../api.js";

/**
 * "AVA starts a conversation" (contract ava-initiative). Every read is
 * validated before the interface trusts it, and every write carries the
 * version it was based on, so a change made elsewhere is never overwritten.
 */

/** Initiative and session IDs as they may appear in a link. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isInitiativeLinkId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export type InitiativeSummary = {
  /** Unreplied invitations that are still open or saved for later. */
  pending: number;
  /** The pending ones Niko has not opened yet. */
  unopened: number;
  newest: { initiativeId: string; sessionId: string; title: string; publishedAt: number } | null;
};

export type InitiativeDispositionState = "open" | "later" | "not_useful" | "engaged";
export type InitiativeDisposition = { state: InitiativeDispositionState; version: number; updatedAt: number | null };
export type InitiativeNotificationState = "none" | "sending" | "accepted" | "rejected" | "unknown" | "no_subscription";

export type InitiativeSourceView =
  | { type: "note"; id: string; title: string | null; available: boolean }
  | {
    type: "calendar_occurrence";
    occurrenceKey: string;
    title: string | null;
    startsAt: number | null;
    endsAt: number | null;
    available: boolean;
  };

export type InitiativeView = {
  id: string;
  sessionId: string;
  title: string;
  reasonNow: string;
  scope: { kind: "project"; folderId: string; name: string } | { kind: "general" };
  publishedAt: number;
  expiresAt: number;
  openedAt: number | null;
  disposition: InitiativeDisposition;
  notification: { state: InitiativeNotificationState };
  sources: InitiativeSourceView[];
};

export type InitiativeSettings = {
  enabled: boolean;
  /** "HH:MM", Europe/Dublin. */
  deliveryLocalTime: string;
  quietStart: string;
  quietEnd: string;
  activeProjectFolderIds: string[];
  version: number;
};

const DISPOSITIONS = new Set<InitiativeDispositionState>(["open", "later", "not_useful", "engaged"]);
const NOTIFICATIONS = new Set<InitiativeNotificationState>(["none", "sending", "accepted", "rejected", "unknown", "no_subscription"]);

function invalid(path: string): ApiError {
  return new ApiError(
    200,
    "AVA returned an idea this version of the app does not understand. Reload AVA and try again.",
    "invalid_api_response",
    null,
    path,
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const time = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === "string" ? value : null;

function readSummary(raw: unknown, path: string): InitiativeSummary {
  const body = record(raw);
  const pending = count(body?.pending);
  const unopened = count(body?.unopened);
  if (!body || pending === null || unopened === null || unopened > pending) throw invalid(path);
  if (pending === 0 || body.newest === null) return { pending, unopened, newest: null };
  const newest = record(body.newest);
  const publishedAt = time(newest?.publishedAt);
  if (!newest || !isInitiativeLinkId(newest.initiativeId) || !isInitiativeLinkId(newest.sessionId)
    || typeof newest.title !== "string" || publishedAt === null) throw invalid(path);
  return {
    pending,
    unopened,
    newest: { initiativeId: newest.initiativeId, sessionId: newest.sessionId, title: newest.title, publishedAt },
  };
}

function readDisposition(raw: unknown): InitiativeDisposition | null {
  const value = record(raw);
  const version = count(value?.version);
  if (!value || !DISPOSITIONS.has(value.state as InitiativeDispositionState) || version === null) return null;
  return { state: value.state as InitiativeDispositionState, version, updatedAt: time(value.updatedAt) };
}

function readSource(raw: unknown): InitiativeSourceView | null {
  const value = record(raw);
  if (!value || typeof value.available !== "boolean") return null;
  if (value.type === "note" && typeof value.id === "string") {
    return { type: "note", id: value.id, title: value.available ? text(value.title) : null, available: value.available };
  }
  if (value.type === "calendar_occurrence" && typeof value.occurrenceKey === "string") {
    return {
      type: "calendar_occurrence",
      occurrenceKey: value.occurrenceKey,
      title: value.available ? text(value.title) : null,
      startsAt: value.available ? time(value.startsAt) : null,
      endsAt: value.available ? time(value.endsAt) : null,
      available: value.available,
    };
  }
  return null;
}

function readView(raw: unknown, path: string): InitiativeView {
  const body = record(raw);
  const scope = record(body?.scope);
  const notification = record(body?.notification);
  const disposition = readDisposition(body?.disposition);
  const publishedAt = time(body?.publishedAt);
  const expiresAt = time(body?.expiresAt);
  if (!body || !isInitiativeLinkId(body.id) || !isInitiativeLinkId(body.sessionId)
    || typeof body.title !== "string" || typeof body.reasonNow !== "string"
    || publishedAt === null || expiresAt === null || !disposition
    || !Array.isArray(body.sources)) throw invalid(path);
  const sources = body.sources.map(readSource);
  if (sources.some((source) => source === null)) throw invalid(path);
  const projectScope = scope?.kind === "project" && typeof scope.folderId === "string" && typeof scope.name === "string"
    ? { kind: "project" as const, folderId: scope.folderId, name: scope.name }
    : null;
  if (!projectScope && scope?.kind !== "general") throw invalid(path);
  const notificationState = NOTIFICATIONS.has(notification?.state as InitiativeNotificationState)
    ? notification!.state as InitiativeNotificationState
    : "unknown";
  return {
    id: body.id,
    sessionId: body.sessionId,
    title: body.title,
    reasonNow: body.reasonNow,
    scope: projectScope ?? { kind: "general" },
    publishedAt,
    expiresAt,
    openedAt: time(body.openedAt),
    disposition,
    notification: { state: notificationState },
    sources: sources as InitiativeSourceView[],
  };
}

function readSettings(raw: unknown, path: string): InitiativeSettings {
  const body = record(raw);
  const version = count(body?.version);
  if (!body || typeof body.enabled !== "boolean" || version === null
    || ![body.deliveryLocalTime, body.quietStart, body.quietEnd].every((value) => typeof value === "string" && LOCAL_TIME.test(value))
    || !Array.isArray(body.activeProjectFolderIds)
    || !body.activeProjectFolderIds.every((id) => typeof id === "string")) throw invalid(path);
  return {
    enabled: body.enabled,
    deliveryLocalTime: body.deliveryLocalTime as string,
    quietStart: body.quietStart as string,
    quietEnd: body.quietEnd as string,
    activeProjectFolderIds: [...body.activeProjectFolderIds as string[]],
    version,
  };
}

function unavailable(error: unknown, path: string): unknown {
  // Missing, deleted, mismatched or inaccessible: one answer that names no IDs.
  return error instanceof ApiError && error.status === 404
    ? new ApiError(404, "This idea is no longer available.", "initiative_unavailable", null, path)
    : error;
}

export function isInitiativeUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "initiative_unavailable";
}

export async function fetchInitiativeSummary(): Promise<InitiativeSummary> {
  const path = "/api/initiatives/inbox-summary";
  return readSummary(await request<unknown>(path), path);
}

export async function fetchInitiative(id: string): Promise<InitiativeView> {
  const path = `/api/initiatives/${encodeURIComponent(id)}`;
  try {
    return readView(await request<unknown>(path), path);
  } catch (error) {
    throw unavailable(error, path);
  }
}

/** Idempotent "seen". Seen is not engagement. */
export async function markInitiativeOpened(id: string): Promise<void> {
  const path = `/api/initiatives/${encodeURIComponent(id)}/opened`;
  try {
    await request<unknown>(path, { method: "POST", body: "{}" });
  } catch (error) {
    throw unavailable(error, path);
  }
}

export type DispositionResult =
  | { ok: true; disposition: InitiativeDisposition }
  /** It changed elsewhere; `current` is what the server holds now, when it said. */
  | { ok: false; current: Pick<InitiativeDisposition, "state" | "version"> | null };

export async function setInitiativeDisposition(
  id: string,
  state: "later" | "not_useful",
  expectedVersion: number,
): Promise<DispositionResult> {
  const path = `/api/initiatives/${encodeURIComponent(id)}/disposition`;
  try {
    const body = record(await request<unknown>(path, { method: "POST", body: JSON.stringify({ state, expectedVersion }) }));
    const disposition = readDisposition(body?.disposition);
    if (!disposition) throw invalid(path);
    return { ok: true, disposition };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === "stale_version") {
      const current = readDisposition(record(error.detail)?.disposition);
      return { ok: false, current: current ? { state: current.state, version: current.version } : null };
    }
    throw unavailable(error, path);
  }
}

export async function fetchInitiativeSettings(): Promise<InitiativeSettings> {
  const path = "/api/initiatives/settings";
  return readSettings(await request<unknown>(path), path);
}

export type SettingsPatch = Partial<Omit<InitiativeSettings, "version">>;
export type SettingsResult = { ok: true; settings: InitiativeSettings } | { ok: false; stale: true };

export async function patchInitiativeSettings(patch: SettingsPatch, expectedVersion: number): Promise<SettingsResult> {
  const path = "/api/initiatives/settings";
  try {
    const body = await request<unknown>(path, { method: "PATCH", body: JSON.stringify({ ...patch, version: expectedVersion }) });
    return { ok: true, settings: readSettings(body, path) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === "stale_version") return { ok: false, stale: true };
    throw error;
  }
}

/** AVA's pending invitations, newest first: the only source of "Idea N of M". */
export async function fetchInboxSessions(limit = 20): Promise<SessionRow[]> {
  const path = `/api/sessions?scope=inbox&limit=${limit}`;
  const body = record(await request<unknown>(path));
  if (!body || !Array.isArray(body.sessions)) throw invalid(path);
  return (body.sessions as SessionRow[]).filter((row) => record(row) && isInitiativeLinkId(row.id));
}
