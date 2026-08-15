import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "../state/db.js";
import { createWatch, listWatches, deleteWatch } from "../state/watches.js";
import type { CodexWatchTarget } from "../watches/codex-dispatch.js";

// Watch tools — how "notify me if the RTX 5090 drops below $1800" becomes a
// standing background check. Ava creates the watch herself in the same turn;
// the scheduler (watches/scheduler.ts) does the recurring work.

type ToolDef = { tool: Tool; run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }> };

export function buildWatchTools(o: { db: Db; resolveCodexTarget?: () => CodexWatchTarget | null }): ToolDef[] {
  return [
    {
      tool: {
        name: "watch_create",
        description:
          "Create a scheduled background task. THREE MODES — " +
          "(1) REMINDER: kind='reminder' + run_in_minutes OR at_local ('HH:MM' 24h; fires at " +
          "the next occurrence — today if still ahead, else tomorrow). The prompt IS the " +
          "notification text pushed to the owner at that moment. Free, instant. " +
          "(2) MONITOR: a check that re-runs every interval_minutes and push-notifies when its " +
          "condition is met (price drops, site changes, news). prompt must be self-contained " +
          "(runs without conversation context). Be frugal: every check is a real agent run. " +
          "(3) DAILY: daily_at='HH:MM' runs the prompt once per day at that time (e.g. a morning briefing). " +
          "(4) CODEX: kind='codex' pins the newest Codex TUI thread for AVA's repo, stages one sanitized " +
          "instruction for its trusted in-thread Stop hook, and verifies the instruction appeared at a clean task " +
          "boundary without starting a competing Codex writer. Set continue_cycle=true " +
          "only when Sir explicitly authorized AVA to select a successor task. Args: { prompt, kind?: " +
          "'check'|'reminder'|'codex', interval_minutes?, run_in_minutes?, at_local?, daily_at?, once?, " +
          "continue_cycle?, parent_watch_id? }.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Check+condition (self-contained), or the reminder text itself." },
            kind: { type: "string", enum: ["check", "reminder", "codex"], description: "codex = verified delivery into a pinned Codex thread." },
            interval_minutes: { type: "number", description: "Monitor mode: minutes between checks (>=5 recommended)." },
            run_in_minutes: { type: "number", description: "One-shot: fire this many minutes from now." },
            at_local: { type: "string", description: "One-shot: fire at next 'HH:MM' (24h local)." },
            daily_at: { type: "string", description: "Recurring: fire every day at 'HH:MM' (24h local)." },
            once: { type: "boolean", description: "Monitor mode: disable after first trigger (default true)." },
            continue_cycle: { type: "boolean", description: "Codex only: ask AVA to select and schedule the next bounded AVA task after completion." },
            parent_watch_id: { type: "string", description: "Codex cycle only: predecessor ID used to prevent duplicate successor watches." },
          },
          required: ["prompt"],
        },
      },
      run: async (args) => {
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        if (!prompt) return { ok: false, text: "watch_create needs a non-empty prompt" };
        const kind = args.kind === "reminder" ? "reminder" as const : args.kind === "codex" ? "codex" as const : "check" as const;
        let runAt: number | undefined;
        if (Number.isFinite(Number(args.run_in_minutes)) && Number(args.run_in_minutes) > 0) {
          runAt = Date.now() + Number(args.run_in_minutes) * 60_000;
        } else if (typeof args.at_local === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(args.at_local)) {
          const [h, m] = args.at_local.split(":").map(Number);
          const d = new Date(); d.setHours(h!, m!, 0, 0);
          if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // next occurrence
          runAt = d.getTime();
        }
        const dailyAt = typeof args.daily_at === "string" ? args.daily_at : undefined;
        const interval = Number(args.interval_minutes);
        if (!runAt && !dailyAt && (!Number.isFinite(interval) || interval < 1)) {
          return { ok: false, text: "need one schedule: run_in_minutes / at_local / daily_at / interval_minutes" };
        }
        try {
          const target = kind === "codex" ? o.resolveCodexTarget?.() ?? null : null;
          if (kind === "codex" && !target) {
            return { ok: false, text: "no active Codex TUI thread for the AVA repository could be pinned" };
          }
          const w = createWatch(o.db, {
            prompt, kind, runAt, dailyAt,
            intervalMinutes: Number.isFinite(interval) ? interval : undefined,
            once: args.once !== false,
            target: target ?? undefined,
            continueCycle: kind === "codex" && args.continue_cycle === true,
            parentWatchId: kind === "codex" && typeof args.parent_watch_id === "string" && args.parent_watch_id.trim()
              ? args.parent_watch_id.trim()
              : undefined,
          });
          const when = runAt
            ? `once at ${new Date(runAt).toLocaleString()}`
            : dailyAt ? `daily at ${dailyAt}` : `every ${w.interval_minutes}min${w.once ? ", stops after first trigger" : ""}`;
          const pin = kind === "codex" ? ` Pinned Codex thread ${w.target_thread_id}.` : "";
          return { ok: true, text: `${kind === "reminder" ? "reminder" : kind === "codex" ? "Codex watch" : "watch"} created (${w.id}) — ${when}.${pin}` };
        } catch (e) {
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
        const lines = all.map((w) =>
          `${w.id} [${w.enabled ? "on" : "off"}] ${w.kind} ${sched(w)} — ${w.prompt.slice(0, 100)}` +
          (w.last_status ? ` | last: ${w.last_status}${w.last_result ? ` (${w.last_result.slice(0, 80)})` : ""}` : " | never run"));
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
