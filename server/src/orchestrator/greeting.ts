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

  // Recap "where we left off" only when the thread is actually stale — Sir
  // remembers what he said half an hour ago, and recapping it reads as
  // filler. (Live testing: the old unconditional recap+"what's next?" kept
  // DISPLACING the answer to his current message.)
  const RECAP_MIN_AGE_MS = 30 * 60_000;
  const recapWorthy = !!last && now - last.created_at > RECAP_MIN_AGE_MS;

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
    `Open with a brief ${tod} greeting, then handle his message below — his ` +
    `current request always comes first and gets a direct answer. ` +
    (recapWorthy
      ? `If his message doesn't itself state a task, add one short clause on ` +
        `where you two left off and ask what's next. `
      : `Do not recap previous sessions — he was here minutes ago. `) +
    `Never let the greeting delay, dilute, or replace the answer.\n\n`;

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
