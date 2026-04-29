import type { Db } from "../state/db.js";
import {
  getDeviceState,
  markGreetingSent,
  getLastUserMessageBefore,
} from "../state/device-state.js";

export type GreetingDecision = {
  greet: boolean;
  /**
   * Synthetic system instruction to prepend to the user transcript on the
   * first turn of the first session of the day. Empty string when greet=false.
   */
  prefix: string;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeOfDay(d: Date): "morning" | "afternoon" | "evening" {
  const h = d.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export type DecideGreetingOpts = {
  db: Db;
  deviceId: string | null | undefined;
  /** Current session id — used to exclude in-flight messages from "last session" lookup. */
  sessionId: string;
  /** ISO yyyy-mm-dd; injectable for deterministic tests. Defaults to today. */
  today?: string;
  /** Now ms; injectable. Defaults to Date.now(). */
  now?: number;
};

/**
 * First-of-day greeting decision. If the device hasn't been greeted today,
 * mark it greeted and return a synthetic system instruction that gives Ava
 * the context she needs (time-of-day + last session timestamp + topic).
 */
export function decideGreeting(opts: DecideGreetingOpts): GreetingDecision {
  if (!opts.deviceId) return { greet: false, prefix: "" };
  const today = opts.today ?? isoToday();
  const state = getDeviceState(opts.db, opts.deviceId);
  if (state?.last_greeting_date === today) return { greet: false, prefix: "" };

  const now = opts.now ?? Date.now();
  const tod = timeOfDay(new Date(now));
  const last = getLastUserMessageBefore(opts.db, opts.sessionId);

  let context: string;
  if (last) {
    const ago = humanAgo(now - last.created_at);
    const snippet = last.content.replace(/\s+/g, " ").slice(0, 200);
    const titlePart = last.session_title ? ` ("${last.session_title}")` : "";
    context = `Sir's last message${titlePart} was ${ago}: "${snippet}".`;
  } else {
    context = "This appears to be Sir's first conversation with you.";
  }

  const prefix =
    `[GREETING CONTEXT]\n` +
    `This is Sir's first session today (${today}, ${tod}).\n` +
    `${context}\n` +
    `Greet him with the time-of-day, then summarize where you and he left off, ` +
    `then ask what's next. Keep it under three sentences.\n\n`;

  markGreetingSent(opts.db, opts.deviceId, today);
  return { greet: true, prefix };
}

function humanAgo(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "moments ago";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  return `${day} days ago`;
}
