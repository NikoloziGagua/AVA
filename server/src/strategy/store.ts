import { nanoid } from "nanoid";
import { scrubSecrets } from "../security/scrub.js";
import type { Db } from "../state/db.js";
import type {
  StrategyActor,
  StrategyEvent,
  StrategyMessage,
  StrategyMessageKind,
  StrategyPhase,
  StrategyRoom,
  StrategyRoomDetail,
  StrategyRoomStatus,
} from "./types.js";

type RoomRow = {
  id: string;
  title: string;
  topic: string;
  status: StrategyRoomStatus;
  phase: StrategyPhase;
  active_actor: StrategyActor | null;
  round: number;
  version: number;
  living_brief: string | null;
  conclusion: string | null;
  codex_thread_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  stopped_at: number | null;
};

type MessageRow = {
  id: string;
  room_id: string;
  sequence: number;
  author: StrategyActor;
  kind: StrategyMessageKind;
  content: string;
  correlation_id: string;
  created_at: number;
};

type EventRow = {
  seq: number;
  event_id: string;
  room_id: string;
  type: string;
  payload: string;
  created_at: number;
};

export type StrategyRoomPatch = Partial<Pick<
  StrategyRoom,
  | "status"
  | "phase"
  | "activeActor"
  | "round"
  | "livingBrief"
  | "conclusion"
  | "codexThreadId"
  | "error"
  | "approvedAt"
  | "stoppedAt"
>>;

export type DecisionResult =
  | { ok: true; room: StrategyRoom }
  | { ok: false; reason: "not_found" | "stale_version" | "invalid_status"; room: StrategyRoom | null };

function roomFromRow(row: RoomRow): StrategyRoom {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    status: row.status,
    phase: row.phase,
    activeActor: row.active_actor,
    round: Number(row.round),
    version: Number(row.version),
    livingBrief: row.living_brief,
    conclusion: row.conclusion,
    codexThreadId: row.codex_thread_id,
    error: row.error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    approvedAt: row.approved_at === null ? null : Number(row.approved_at),
    stoppedAt: row.stopped_at === null ? null : Number(row.stopped_at),
  };
}

function messageFromRow(row: MessageRow): StrategyMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    sequence: Number(row.sequence),
    author: row.author,
    kind: row.kind,
    content: row.content,
    correlationId: row.correlation_id,
    createdAt: Number(row.created_at),
  };
}

function eventFromRow(row: EventRow): StrategyEvent {
  let payload: unknown = {};
  try { payload = JSON.parse(row.payload) as unknown; } catch { payload = {}; }
  return {
    seq: Number(row.seq),
    eventId: row.event_id,
    roomId: row.room_id,
    type: row.type,
    payload,
    createdAt: Number(row.created_at),
  };
}

function safeText(value: string, max = 32_000): string {
  return scrubSecrets(value.trim()).slice(0, max);
}

function titleFor(topic: string): string {
  const oneLine = topic.replace(/\s+/g, " ").trim();
  return oneLine.length <= 72 ? oneLine : `${oneLine.slice(0, 69)}...`;
}

export class StrategyRoomStore {
  private readonly listeners = new Set<(event: StrategyEvent) => void>();

  constructor(readonly db: Db) {}

  createRoom(topic: string): StrategyRoomDetail {
    const id = `room_${nanoid(12)}`;
    const correlationId = `strategy_${nanoid(14)}`;
    const now = Date.now();
    const safeTopic = safeText(topic, 8_000);
    this.db.prepare(`
      INSERT INTO strategy_rooms (
        id, title, topic, status, phase, active_actor, round, version,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'discussing', 'framing', 'ava', 1, 1, ?, ?)
    `).run(id, titleFor(safeTopic), safeTopic, now, now);
    const message = this.appendMessage(id, {
      author: "niko",
      kind: "message",
      content: safeTopic,
      correlationId,
    });
    const room = this.getRoom(id)!;
    this.emit(id, "strategy.room.created", { roomId: id, version: room.version });
    return { room, messages: [message] };
  }

  getRoom(id: string): StrategyRoom | null {
    const row = this.db.prepare("SELECT * FROM strategy_rooms WHERE id = ?").get(id) as RoomRow | undefined;
    return row ? roomFromRow(row) : null;
  }

  listRooms(limit = 50): StrategyRoom[] {
    return (this.db.prepare(
      "SELECT * FROM strategy_rooms ORDER BY updated_at DESC, rowid DESC LIMIT ?",
    ).all(Math.max(1, Math.min(100, limit))) as RoomRow[]).map(roomFromRow);
  }

  getDetail(id: string): StrategyRoomDetail | null {
    const room = this.getRoom(id);
    if (!room) return null;
    return { room, messages: this.listMessages(id) };
  }

  listMessages(roomId: string): StrategyMessage[] {
    return (this.db.prepare(
      "SELECT * FROM strategy_messages WHERE room_id = ? ORDER BY sequence ASC",
    ).all(roomId) as MessageRow[]).map(messageFromRow);
  }

  appendMessage(roomId: string, input: {
    author: StrategyActor;
    kind: StrategyMessageKind;
    content: string;
    correlationId?: string;
    id?: string;
  }): StrategyMessage {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("strategy room not found");
    const now = Date.now();
    const id = input.id ?? `msg_${nanoid(14)}`;
    const sequence = Number((this.db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM strategy_messages WHERE room_id = ?",
    ).get(roomId) as { next: number }).next);
    const content = safeText(input.content);
    this.db.prepare(`
      INSERT INTO strategy_messages (
        id, room_id, sequence, author, kind, content, correlation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roomId,
      sequence,
      input.author,
      input.kind,
      content,
      input.correlationId ?? `strategy_${nanoid(14)}`,
      now,
    );
    this.db.prepare(
      "UPDATE strategy_rooms SET updated_at = ?, version = version + 1 WHERE id = ?",
    ).run(now, roomId);
    const message = messageFromRow(this.db.prepare(
      "SELECT * FROM strategy_messages WHERE id = ?",
    ).get(id) as MessageRow);
    this.emit(roomId, "strategy.message.created", {
      messageId: message.id,
      author: message.author,
      kind: message.kind,
      sequence: message.sequence,
    });
    return message;
  }

  updateRoom(id: string, patch: StrategyRoomPatch): StrategyRoom {
    const column: Record<keyof StrategyRoomPatch, string> = {
      status: "status",
      phase: "phase",
      activeActor: "active_actor",
      round: "round",
      livingBrief: "living_brief",
      conclusion: "conclusion",
      codexThreadId: "codex_thread_id",
      error: "error",
      approvedAt: "approved_at",
      stoppedAt: "stopped_at",
    };
    const entries = Object.entries(patch) as Array<[keyof StrategyRoomPatch, unknown]>;
    if (entries.length === 0) {
      const current = this.getRoom(id);
      if (!current) throw new Error("strategy room not found");
      return current;
    }
    const current = this.getRoom(id);
    if (!current) throw new Error("strategy room not found");
    const now = Date.now();
    const set = entries.map(([key]) => `${column[key]} = ?`).join(", ");
    this.db.prepare(
      `UPDATE strategy_rooms SET ${set}, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).run(...entries.map(([, value]) => typeof value === "string" ? safeText(value) : value), now, id);
    const next = this.getRoom(id)!;
    this.emit(id, "strategy.room.updated", {
      status: next.status,
      phase: next.phase,
      activeActor: next.activeActor,
      version: next.version,
    });
    return next;
  }

  approve(id: string, expectedVersion: number): DecisionResult {
    const current = this.getRoom(id);
    if (!current) return { ok: false, reason: "not_found", room: null };
    if (current.version !== expectedVersion) return { ok: false, reason: "stale_version", room: current };
    if (current.status !== "awaiting_niko" || !current.conclusion) {
      return { ok: false, reason: "invalid_status", room: current };
    }
    const now = Date.now();
    const changed = this.db.prepare(`
      UPDATE strategy_rooms
      SET status = 'approved', phase = 'approved', active_actor = NULL,
          approved_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'awaiting_niko'
    `).run(now, now, id, expectedVersion).changes;
    if (changed !== 1) return { ok: false, reason: "stale_version", room: this.getRoom(id) };
    this.appendMessage(id, {
      author: "system",
      kind: "decision",
      content: "Niko approved this conclusion. Approval records the decision only; no implementation was started.",
    });
    const room = this.getRoom(id)!;
    this.emit(id, "strategy.decision.approved", { version: room.version, approvedAt: room.approvedAt });
    return { ok: true, room };
  }

  pause(id: string, expectedVersion: number): DecisionResult {
    const current = this.getRoom(id);
    if (!current) return { ok: false, reason: "not_found", room: null };
    if (current.version !== expectedVersion) return { ok: false, reason: "stale_version", room: current };
    if (current.status !== "discussing") return { ok: false, reason: "invalid_status", room: current };
    const room = this.updateRoom(id, {
      status: "paused",
      phase: "paused",
      activeActor: null,
      stoppedAt: Date.now(),
      error: null,
    });
    this.appendMessage(id, {
      author: "system",
      kind: "status",
      content: "Niko paused this discussion. No agent work is continuing.",
    });
    return { ok: true, room: this.getRoom(id) ?? room };
  }

  reopenForInput(id: string): StrategyRoom {
    const current = this.getRoom(id);
    if (!current) throw new Error("strategy room not found");
    return this.updateRoom(id, {
      status: "discussing",
      phase: "framing",
      activeActor: "ava",
      round: current.round + 1,
      approvedAt: null,
      stoppedAt: null,
      error: null,
    });
  }

  failInterruptedRooms(): number {
    const rows = this.db.prepare(
      "SELECT id FROM strategy_rooms WHERE status = 'discussing'",
    ).all() as Array<{ id: string }>;
    for (const row of rows) {
      this.db.prepare(`
        UPDATE strategy_rooms
        SET status = 'paused', phase = 'paused', active_actor = NULL,
            error = 'interrupted by a server restart', updated_at = ?, version = version + 1
        WHERE id = ?
      `).run(Date.now(), row.id);
      this.emit(row.id, "strategy.room.interrupted", { reason: "server_restart" });
    }
    return rows.length;
  }

  eventsAfter(after: number, limit = 2_000): StrategyEvent[] {
    return (this.db.prepare(
      "SELECT * FROM strategy_events WHERE seq > ? ORDER BY seq ASC LIMIT ?",
    ).all(Math.max(0, after), Math.max(1, Math.min(5_000, limit))) as EventRow[]).map(eventFromRow);
  }

  eventBounds(): { min: number | null; max: number | null } {
    const row = this.db.prepare(
      "SELECT MIN(seq) AS min, MAX(seq) AS max FROM strategy_events",
    ).get() as { min: number | null; max: number | null };
    return { min: row.min === null ? null : Number(row.min), max: row.max === null ? null : Number(row.max) };
  }

  subscribe(listener: (event: StrategyEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordEvent(roomId: string, type: string, payload: unknown): StrategyEvent {
    return this.emit(roomId, type, payload);
  }

  private emit(roomId: string, type: string, payload: unknown): StrategyEvent {
    const eventId = `stevt_${nanoid(14)}`;
    const createdAt = Date.now();
    const safePayload = scrubSecrets(JSON.stringify(payload)).slice(0, 16_000);
    const info = this.db.prepare(`
      INSERT INTO strategy_events (event_id, room_id, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, roomId, type, safePayload, createdAt);
    let parsedPayload: unknown = {};
    try { parsedPayload = JSON.parse(safePayload) as unknown; } catch { parsedPayload = {}; }
    const event: StrategyEvent = {
      seq: Number(info.lastInsertRowid),
      eventId,
      roomId,
      type,
      payload: parsedPayload,
      createdAt,
    };
    for (const listener of this.listeners) listener(event);
    return event;
  }
}
