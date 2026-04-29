import type { Db } from "./db.js";

export type DeviceState = {
  device_id: string;
  last_greeting_date: string | null;
  updated_at: number;
};

export function getDeviceState(db: Db, deviceId: string): DeviceState | null {
  const row = db
    .prepare("SELECT device_id, last_greeting_date, updated_at FROM device_state WHERE device_id = ?")
    .get(deviceId) as DeviceState | undefined;
  return row ?? null;
}

export function markGreetingSent(db: Db, deviceId: string, date: string): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO device_state (device_id, last_greeting_date, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(device_id) DO UPDATE SET last_greeting_date = excluded.last_greeting_date, updated_at = excluded.updated_at",
  ).run(deviceId, date, now);
}

export function getLastUserMessageBefore(
  db: Db,
  beforeSessionId: string,
): { content: string; created_at: number; session_id: string; session_title: string | null } | null {
  const row = db
    .prepare(
      `SELECT m.content, m.created_at, m.session_id, s.title AS session_title
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.role = 'user' AND m.session_id != ?
       ORDER BY m.created_at DESC
       LIMIT 1`,
    )
    .get(beforeSessionId) as
    | { content: string; created_at: number; session_id: string; session_title: string | null }
    | undefined;
  return row ?? null;
}
