import type { ToolDef } from "./ava-mcp.js";
import { memoryPaths } from "../memory/paths.js";
import { writeFile, appendLine, readFile as readMemFile } from "../memory/store.js";
import { applyRefresh, applySupersede, serializeObservation, type Confidence } from "../memory/observations.js";

export type MemoryToolDeps = { memoryDir: string };

function buildMemoryRead(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_read",
      description:
        "Read durable memory. Use when Sir asks 'what do you remember about…' rather than reciting from the system prompt.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["all", "preferences", "observations", "project"] },
          project: { type: "string", description: "Required when file=project; slug." },
        },
        required: ["file"],
      },
    },
    run: async (args) => {
      const file = String(args.file ?? "");
      const p = memoryPaths(deps.memoryDir);
      if (file === "preferences") return { ok: true, text: readMemFile(p.preferences) };
      if (file === "observations") return { ok: true, text: readMemFile(p.observations) };
      if (file === "project") {
        const slug = String(args.project ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        try {
          return { ok: true, text: readMemFile(p.projectFile(slug)) };
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      }
      if (file === "all") {
        const parts = [
          readMemFile(p.memoryIndex),
          readMemFile(p.preferences),
          readMemFile(p.observations),
        ].filter((s) => s.length > 0);
        return { ok: true, text: parts.join("\n---\n") };
      }
      return { ok: false, text: `unknown file: ${file}` };
    },
  };
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildMemoryRemember(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_remember",
      description:
        "Write durable memory. Default file=observations. Use refresh=<substring> to bump an existing observation's confidence/date instead of duplicating. Use supersedes=<substring> to mark a contradicted observation and append the new one.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["preferences", "observations", "project"] },
          project: { type: "string", description: "Required when file=project; slug." },
          text: { type: "string" },
          category: { type: "string", description: "Required for observations." },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          refresh: { type: "string", description: "Substring of an existing observation to bump." },
          supersedes: { type: "string", description: "Substring of an existing observation to mark superseded." },
          today: { type: "string", description: "ISO yyyy-mm-dd; injectable for tests." },
        },
      },
    },
    run: async (args) => {
      const p = memoryPaths(deps.memoryDir);
      const today = String(args.today ?? isoToday());
      const file = String(args.file ?? "observations");

      if (typeof args.refresh === "string" && args.refresh.length > 0) {
        const r = applyRefresh(readMemFile(p.observations),
          { match: args.refresh, today });
        if (!r.changed) return { ok: false, text: "refresh: no matching observation" };
        writeFile(p.observations, r.content);
        return { ok: true, text: "refreshed" };
      }

      if (file === "preferences") {
        const text = String(args.text ?? "").trim();
        if (!text) return { ok: false, text: "missing text" };
        appendLine(p.preferences, text);
        return { ok: true, text: "remembered (preferences)" };
      }

      if (file === "project") {
        const slug = String(args.project ?? "").trim();
        const text = String(args.text ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        if (!text) return { ok: false, text: "missing text" };
        try {
          appendLine(p.projectFile(slug), text);
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
        return { ok: true, text: `remembered (project:${slug})` };
      }

      // file === "observations"
      const text = String(args.text ?? "").trim();
      const category = String(args.category ?? "context").trim();
      const confidence = (args.confidence as Confidence | undefined) ?? "low";
      if (!text) return { ok: false, text: "missing text" };

      if (typeof args.supersedes === "string" && args.supersedes.length > 0) {
        const r = applySupersede(readMemFile(p.observations),
          { match: args.supersedes, today });
        if (r.changed) writeFile(p.observations, r.content);
      }
      const line = serializeObservation({
        date: today, confidence, category, text, superseded: null,
      });
      appendLine(p.observations, line);
      return { ok: true, text: "remembered (observation)" };
    },
  };
}

export function buildMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  return [buildMemoryRead(deps), buildMemoryRemember(deps)];
}
