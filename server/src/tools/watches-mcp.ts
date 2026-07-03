import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "../state/db.js";
import { createWatch, listWatches, deleteWatch } from "../state/watches.js";

// Watch tools — how "notify me if the RTX 5090 drops below $1800" becomes a
// standing background check. Ava creates the watch herself in the same turn;
// the scheduler (watches/scheduler.ts) does the recurring work.

type ToolDef = { tool: Tool; run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }> };

export function buildWatchTools(o: { db: Db }): ToolDef[] {
  return [
    {
      tool: {
        name: "watch_create",
        description:
          "Create a standing background watch: a check that re-runs on an interval and " +
          "push-notifies the owner when its condition is met (price drops, site changes, " +
          "news, deliveries). Args: { prompt: string — what to check AND what condition " +
          "triggers the notification, self-contained since it runs without conversation " +
          "context; interval_minutes: number (>=5 recommended; be frugal — each check " +
          "costs a real agent run); once?: boolean (default true — stop after first trigger) }.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Self-contained check + trigger condition." },
            interval_minutes: { type: "number", description: "Minutes between checks (>=1)." },
            once: { type: "boolean", description: "Disable after first trigger (default true)." },
          },
          required: ["prompt", "interval_minutes"],
        },
      },
      run: async (args) => {
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        const interval = Number(args.interval_minutes);
        if (!prompt || !Number.isFinite(interval) || interval < 1) {
          return { ok: false, text: "watch_create needs a non-empty prompt and interval_minutes >= 1" };
        }
        const w = createWatch(o.db, { prompt, intervalMinutes: interval, once: args.once !== false });
        return { ok: true, text: `watch created (${w.id}) — every ${w.interval_minutes}min${w.once ? ", stops after first trigger" : ""}. First check runs within a minute.` };
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
        const lines = all.map((w) =>
          `${w.id} [${w.enabled ? "on" : "off"}] every ${w.interval_minutes}min — ${w.prompt.slice(0, 100)}` +
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
