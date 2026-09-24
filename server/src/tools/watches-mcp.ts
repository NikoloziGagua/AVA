import type { Db } from "../state/db.js";
import { createWatch, listWatches, deleteWatch } from "../state/watches.js";
import { getReminderStatus } from "../state/reminders.js";
import { ReminderScheduleError, resolveReminderInstant, validateReminderSchedule } from "../watches/reminder-schedule.js";
import type { CodexWatchTarget } from "../watches/codex-dispatch.js";
import type { ToolDef } from "./ava-mcp.js";
import type { ObservabilityService } from "../observability/store.js";
import {
  CommunicationObservabilityRecorder,
  communicationRunId,
} from "../observability/communications.js";

// Watch tools — how "notify me if the RTX 5090 drops below $1800" becomes a
// standing background check. Ava creates the watch herself in the same turn;
// the scheduler (watches/scheduler.ts) does the recurring work.

/**
 * Strict tool calling makes the model send every field, so the ones it does
 * not mean arrive as "" or 0. Those are absent, never a second schedule: left
 * as-is, `at: ""` was an invalid date and `run_in_minutes: 0` beside `at` a
 * conflict, which refused every reminder and check the AI tried to create.
 */
export function withoutBlankScheduleFields<T extends Record<string, unknown>>(args: T): T {
  const clean: Record<string, unknown> = { ...args };
  for (const key of ["at", "at_local", "daily_at", "time_zone", "parent_watch_id"]) {
    const value = clean[key];
    if (value === null || (typeof value === "string" && value.trim() === "")) delete clean[key];
  }
  for (const key of ["run_in_minutes", "interval_minutes"]) {
    if (clean[key] === null || clean[key] === 0) delete clean[key];
  }
  return clean as T;
}

export function buildWatchTools(o: {
  db: Db;
  resolveCodexTarget?: () => CodexWatchTarget | null;
  observability?: ObservabilityService;
}): ToolDef[] {
  return [
    {
      tool: {
        name: "watch_create",
        description:
          "Create a scheduled background task. FOUR MODES — " +
          "(1) ONE-OFF REMINDER: kind='reminder' + time_zone (IANA name or UTC) + either " +
          "at (full date/time with seconds and explicit offset, e.g. 2026-10-25T01:30:00+01:00) " +
          "or numeric run_in_minutes. The at wall time and offset must match time_zone. " +
          "Choose a future time within 366 days; do not use at_local, daily_at, interval_minutes or once=false. " +
          "The prompt is the notification text. Creation proves scheduling, not phone delivery; " +
          "AVA must be awake and online, and push setup is required. " +
          "(2) MONITOR: a check that re-runs every interval_minutes and push-notifies when its " +
          "condition is met (price drops, site changes, news). prompt must be self-contained " +
          "(runs without conversation context). Be frugal: every check is a real agent run. " +
          "(3) DAILY: daily_at='HH:MM' runs the prompt once per day at that time (e.g. a morning briefing). " +
          "(4) CODEX: kind='codex' pins the newest Codex TUI thread for AVA's repo, submits one sanitized " +
          "message through Codex's acknowledged exact-thread queue, and verifies the unique marker appeared and " +
          "completed without terminal keystrokes or a competing Codex writer. Set continue_cycle=true " +
          "only when Sir explicitly authorized AVA to select a successor task. Args: { prompt, kind?: " +
          "'check'|'reminder'|'codex', at?, time_zone?, interval_minutes?, run_in_minutes?, at_local?, daily_at?, once?, " +
          "continue_cycle?, parent_watch_id? }.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Check+condition (self-contained), or the reminder text itself." },
            kind: { type: "string", enum: ["check", "reminder", "codex"], description: "codex = verified delivery into a pinned Codex thread." },
            interval_minutes: { type: "number", description: "Monitor mode: minutes between checks (>=5 recommended)." },
            run_in_minutes: { type: "number", description: "One-shot: fire this many minutes from now." },
            at: { type: "string", description: "One-off reminder: full date/time with seconds and explicit offset; wall time and offset must match time_zone. Example: 2026-10-25T01:30:00+01:00." },
            time_zone: { type: "string", description: "Required for one-off reminders: UTC or a named IANA zone, e.g. Europe/London. Not a numeric offset." },
            at_local: { type: "string", description: "Legacy check/Codex scheduling only: next 'HH:MM' in server-local time. One-off reminders must use at or run_in_minutes with time_zone." },
            daily_at: { type: "string", description: "Recurring: fire every day at 'HH:MM' (24h local)." },
            once: { type: "boolean", description: "Monitor mode: disable after first trigger (default true)." },
            continue_cycle: { type: "boolean", description: "Codex only: ask AVA to select and schedule the next bounded AVA task after completion." },
            parent_watch_id: { type: "string", description: "Codex cycle only: predecessor ID used to prevent duplicate successor watches." },
          },
          required: ["prompt"],
        },
      },
      run: async (rawArgs, ctx = { runId: "watch-tool" }) => {
        const args = withoutBlankScheduleFields(rawArgs);
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        if (!prompt) return { ok: false, text: "watch_create needs a non-empty prompt" };
        const kind = args.kind === "reminder" ? "reminder" as const : args.kind === "codex" ? "codex" as const : "check" as const;
        try {
          let runAt: number | undefined;
          let timeZone: string | undefined;
          const reminderOneOff = kind === "reminder" && (
            args.at !== undefined || args.run_in_minutes !== undefined || args.at_local !== undefined ||
            (args.daily_at === undefined && args.interval_minutes === undefined)
          );
          if (reminderOneOff) {
            if (prompt.length > 2000) return { ok: false, text: "one-off reminder prompt must not exceed 2000 characters" };
            const now = Date.now();
            if (args.at_local !== undefined) throw new ReminderScheduleError("invalid_at");
            if (args.at !== undefined && args.run_in_minutes !== undefined) {
              throw new ReminderScheduleError("conflicting_schedule");
            }
            let instant: number;
            if (args.at !== undefined) {
              if (typeof args.at !== "string") throw new ReminderScheduleError("invalid_at");
              if (typeof args.time_zone !== "string") throw new ReminderScheduleError("invalid_time_zone");
              instant = resolveReminderInstant(args.at, args.time_zone, now).runAt;
            } else {
              if (typeof args.run_in_minutes !== "number" || !Number.isFinite(args.run_in_minutes) || args.run_in_minutes <= 0) {
                throw new ReminderScheduleError("invalid_run_at");
              }
              instant = now + args.run_in_minutes * 60_000;
            }
            const validated = validateReminderSchedule({
              runAt: instant, timeZone: args.time_zone,
              intervalMinutes: args.interval_minutes, dailyAt: args.daily_at, once: args.once,
            }, now);
            runAt = validated.runAt;
            timeZone = validated.timeZone;
          } else {
            // Existing recurring reminders, checks and pinned Codex tasks retain
            // their schedule semantics; the new named-zone form is one-off only.
            if (args.at !== undefined || args.time_zone !== undefined) {
              return { ok: false, text: "at and time_zone are supported only for one-off reminders" };
            }
            if (Number.isFinite(Number(args.run_in_minutes)) && Number(args.run_in_minutes) > 0) {
              runAt = Date.now() + Number(args.run_in_minutes) * 60_000;
            } else if (typeof args.at_local === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(args.at_local)) {
              const [h, m] = args.at_local.split(":").map(Number);
              const d = new Date(); d.setHours(h!, m!, 0, 0);
              if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
              runAt = d.getTime();
            }
          }
          const dailyAt = typeof args.daily_at === "string" ? args.daily_at : undefined;
          const interval = Number(args.interval_minutes);
          if (!runAt && !dailyAt && (!Number.isFinite(interval) || interval < 1)) {
            return { ok: false, text: "need one schedule: at with time_zone / run_in_minutes / at_local / daily_at / interval_minutes" };
          }
          const target = kind === "codex" ? o.resolveCodexTarget?.() ?? null : null;
          if (kind === "codex" && !target) {
            return { ok: false, text: "no active Codex TUI thread for the AVA repository could be pinned" };
          }
          const w = createWatch(o.db, {
            prompt, kind, runAt, dailyAt, timeZone,
            intervalMinutes: Number.isFinite(interval) ? interval : undefined,
            once: args.once !== false,
            target: target ?? undefined,
            continueCycle: kind === "codex" && args.continue_cycle === true,
            parentWatchId: kind === "codex" && typeof args.parent_watch_id === "string" && args.parent_watch_id.trim()
              ? args.parent_watch_id.trim()
              : undefined,
          });
          if (kind === "codex") {
            const requestedCycleParent = w.parent_watch_id
              ? communicationRunId("codex_watcher", w.parent_watch_id)
              : null;
            const parentRunId = requestedCycleParent && o.observability?.getRun(requestedCycleParent)
              ? requestedCycleParent
              : ctx.runId;
            new CommunicationObservabilityRecorder(o.observability).ensureStarted({
              source: "codex_watcher",
              sourceId: w.id,
              runtimeType: "codex",
              title: "Codex watcher handoff",
              requestSummary: prompt,
              sessionId: null,
              parentRunId,
              startedAt: w.created_at,
            });
          }
          const when = runAt
            ? `once at ${new Date(runAt).toLocaleString()}`
            : dailyAt ? `daily at ${dailyAt}` : `every ${w.interval_minutes}min${w.once ? ", stops after first trigger" : ""}`;
          const pin = kind === "codex" ? ` Pinned Codex thread ${w.target_thread_id}.` : "";
          if (reminderOneOff) {
            const status = getReminderStatus(o.db, w);
            const localTime = new Intl.DateTimeFormat("en-GB", {
              timeZone, dateStyle: "full", timeStyle: "long",
            }).format(runAt);
            return {
              ok: true,
              text: `reminder scheduled (${w.id}) — ${localTime} [${timeZone}]; ${new Date(runAt!).toISOString()}. ` +
                "Push service acceptance and phone receipt are not yet confirmed. AVA must remain awake and online." +
                (status ? `\nreminder_status: ${JSON.stringify(status)}` : "\nDelivery not recorded."),
            };
          }
          return { ok: true, text: `${kind === "reminder" ? "reminder" : kind === "codex" ? "Codex watch" : "watch"} created (${w.id}) — ${when}.${pin}` };
        } catch (e) {
          // Say plainly that nothing exists, so the agent reports the failure
          // instead of improvising a local pop-up and calling it scheduled.
          if (e instanceof ReminderScheduleError) {
            return { ok: false, text: `${e.code}: ${e.message} Nothing was scheduled; tell Sir, and don't substitute a pop-up or timer.` };
          }
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      tool: {
        name: "watch_list",
        description: "List the owner's standing watches with their latest status.",
        inputSchema: { type: "object", properties: {} },
      },
      run: async () => {
        const all = listWatches(o.db);
        if (!all.length) return { ok: true, text: "no watches" };
        const sched = (w: (typeof all)[number]) =>
          w.run_at !== null ? `once at ${new Date(w.run_at).toLocaleString()}`
            : w.daily_at ? `daily at ${w.daily_at}`
              : `every ${w.interval_minutes}min`;
        const lines = all.map((w) => {
          const reminderOneOff = w.kind === "reminder" && w.run_at !== null;
          const status = reminderOneOff ? getReminderStatus(o.db, w) : undefined;
          const due = reminderOneOff ? new Date(w.run_at!) : null;
          const schedule = reminderOneOff
            ? due && Number.isFinite(due.getTime())
              ? `once at ${due.toISOString()}${w.time_zone ? ` [${w.time_zone}]` : " [timezone not recorded]"}`
              : "schedule unknown"
            : sched(w);
          return `${w.id} [${w.enabled ? "on" : "off"}] ${w.kind} ${schedule} — ${w.prompt.slice(0, 100)}` +
          (reminderOneOff
            ? status ? ` | reminder_status: ${JSON.stringify(status)} | phone receipt unconfirmed` : " | delivery not recorded; phone receipt unconfirmed"
            : w.last_status ? ` | last: ${w.last_status}${w.last_result ? ` (${w.last_result.slice(0, 80)})` : ""}` : " | never run") +
          (w.kind === "codex" && w.continue_cycle && w.successor_status
            ? ` | next: ${w.successor_status}${w.successor_result ? ` (${w.successor_result.slice(0, 120)})` : ""}`
            : "");
        });
        return { ok: true, text: lines.join("\n") };
      },
    },
    {
      tool: {
        name: "watch_delete",
        description: "Delete a watch by id (from watch_list).",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      run: async (args) => {
        const id = typeof args.id === "string" ? args.id : "";
        return deleteWatch(o.db, id)
          ? { ok: true, text: `watch ${id} deleted` }
          : { ok: false, text: `no watch with id ${id}` };
      },
    },
  ];
}
