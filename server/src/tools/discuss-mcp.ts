import type { ToolDef } from "./ava-mcp.js";
import type { Discussion } from "../state/discussions.js";

export function buildDiscussTools(deps: {
  queue: (topic: string, sessionId: string | null) => string;
  list: () => Discussion[];
  get: (id: string) => Discussion | null;
  sessionId: string | null;
}): ToolDef[] {
  const discuss: ToolDef = {
    tool: {
      name: "discuss_with_claude",
      description:
        "Confer with Claude (my developer) about a topic WITHOUT freezing our chat. " +
        "Runs in the background and returns immediately, so I keep talking to Sir and " +
        "tell him what Claude came back with when it's done (read_discussion). It's " +
        "READ-ONLY analysis — Claude does not change any files. Use when Sir says " +
        "'discuss/check/run this by Claude' or wants Claude's input on a question. Args: { topic }.",
      inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
    },
    run: async (args) => {
      const topic = String(args.topic ?? "").trim();
      if (!topic) return { ok: false, text: "missing topic" };
      deps.queue(topic, deps.sessionId);
      return {
        ok: true,
        text: `Started conferring with Claude about "${topic}", Sir — I'll keep talking with you and tell you what we come up with when we're done.`,
      };
    },
  };

  const read: ToolDef = {
    tool: {
      name: "read_discussion",
      description:
        "Recount what Claude and I came up with. Pass { id } for the full result of one " +
        "discussion; with no id, list recent discussions with their status and show the " +
        "latest finished one's result. Use for 'what did you and Claude decide/come up with?'.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "optional discussion id" } } },
    },
    run: async (args) => {
      const id = String(args.id ?? "").trim();

      if (id) {
        const d = deps.get(id);
        if (!d) return { ok: true, text: `No discussion ${id}.` };
        const out = [`Discussion about "${d.topic}" — ${d.status}.`];
        if (d.status === "done" && d.result) out.push("", `Claude's input:`, d.result);
        else if (d.status === "failed") out.push("", `It didn't complete — ${d.error ?? "unknown error"}`);
        else out.push("", "Still in progress — I'll let you know when it's done.");
        return { ok: true, text: out.join("\n") };
      }

      const all = deps.list();
      if (all.length === 0) return { ok: true, text: "Claude and I haven't discussed anything yet, Sir." };

      const status = (d: Discussion) =>
        d.status === "done" ? "done" : d.status === "failed" ? `failed — ${d.error ?? "unknown error"}` : "in progress";
      const lines = all.map((d) => `• ${d.id} [${status(d)}] ${d.topic}`);

      const latestDone = all.find((d) => d.status === "done" && d.result);
      if (latestDone) {
        lines.push("", `Latest result — "${latestDone.topic}":`, latestDone.result!);
      }
      return { ok: true, text: lines.join("\n") };
    },
  };

  return [discuss, read];
}
