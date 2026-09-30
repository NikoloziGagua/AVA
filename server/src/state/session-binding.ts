import type { Db } from "./db.js";
import { createSession, getMostRecentHumanSession, getSession, type Session, type SessionOrigin } from "./sessions.js";

export type SessionBinding = {
  version: 1;
  sessionId: string;
  origin: SessionOrigin;
  resolution: "created" | "resumed_exact" | "continued";
  bindingRequestId?: string;
};

export type ConversationRequest = {
  actor: "human" | "automation" | "voice_action";
  deviceId: string;
  intent: "new" | "resume" | "continue";
  sessionId?: string | null;
  bindingRequestId?: string;
  title?: string | null;
};

export class SessionBindingError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: "bad_request" | "session_unavailable",
    message = code === "session_unavailable" ? "This conversation is unavailable." : "Invalid conversation request",
  ) { super(message); }
}

function badRequest(): never { throw new SessionBindingError(400, "bad_request"); }
function unavailable(): never { throw new SessionBindingError(404, "session_unavailable"); }

/** A delegated action must not stream from or cancel a different conversation,
 * even if an unexpected loopback acknowledgement supplies another ID. */
export function requireExactSessionAcknowledgement(expectedId: string | null, value: unknown): string {
  if (!expectedId || !value || typeof value !== "object" || Array.isArray(value)) unavailable();
  const result = value as { sessionId?: unknown; binding?: unknown };
  if (result.sessionId !== expectedId) unavailable();
  if (result.binding !== undefined) {
    if (!result.binding || typeof result.binding !== "object" || Array.isArray(result.binding)
      || (result.binding as { sessionId?: unknown }).sessionId !== expectedId) unavailable();
  }
  return expectedId;
}

function validateRequest(request: ConversationRequest): void {
  if (!request || !["human", "automation", "voice_action"].includes(request.actor)
    || !["new", "resume", "continue"].includes(request.intent)
    || typeof request.deviceId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(request.deviceId)
    || request.title !== undefined && request.title !== null && typeof request.title !== "string") badRequest();
  if (request.bindingRequestId !== undefined
    && (typeof request.bindingRequestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.bindingRequestId))) badRequest();
  const hasId = request.sessionId !== undefined && request.sessionId !== null;
  if (hasId && (typeof request.sessionId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(request.sessionId!))) badRequest();
  if (request.intent === "resume" ? !hasId : hasId) badRequest();
  if (request.actor === "voice_action" && request.intent !== "resume") badRequest();
}

/**
 * One authoritative binding decision per ingress, atomic across SQLite
 * connections. Binding alone is not human activity: callers stamp only after
 * accepting a real human text/voice turn, never on connect or a rejected turn.
 */
export function resolveConversation(db: Db, request: ConversationRequest): SessionBinding {
  validateRequest(request);
  return db.transaction((): SessionBinding => {
    const { actor, intent, bindingRequestId } = request;
    const bind = (session: Session, resolution: SessionBinding["resolution"]): SessionBinding => {
      if (actor !== "automation" && session.origin === "automation") unavailable();
      return {
        version: 1, sessionId: session.id, origin: session.origin, resolution,
        ...(bindingRequestId === undefined ? {} : { bindingRequestId }),
      };
    };
    if (intent === "resume") {
      const session = getSession(db, request.sessionId!);
      if (!session) unavailable();
      return bind(session, "resumed_exact");
    }
    if (intent === "new" && bindingRequestId !== undefined) {
      const existing = db.prepare(`SELECT session_id, actor FROM session_binding_requests
        WHERE device_id = ? AND binding_request_id = ?
      `).get(request.deviceId, bindingRequestId) as { session_id: string; actor: string } | undefined;
      if (existing) {
        if (existing.actor !== actor) badRequest();
        const session = getSession(db, existing.session_id);
        if (!session) unavailable();
        return bind(session, "created");
      }
    }
    if (intent === "continue") {
      const session = actor === "human" ? getMostRecentHumanSession(db)
        : db.prepare(`SELECT * FROM sessions
            WHERE deleted_at IS NULL AND status != 'archived' AND origin = 'automation'
            ORDER BY updated_at DESC, id DESC LIMIT 1
          `).get() as Session | undefined;
      if (session) return bind(session, "continued");
    }
    const session = createSession(db, { title: request.title, origin: actor === "human" ? "human" : "automation" });
    if (intent === "new" && bindingRequestId !== undefined) {
      db.prepare(`INSERT INTO session_binding_requests
        (device_id, binding_request_id, session_id, actor, created_at) VALUES (?, ?, ?, ?, ?)
      `).run(request.deviceId, bindingRequestId, session.id, actor, Date.now());
    }
    return bind(session, "created");
  }).immediate();
}
