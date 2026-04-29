import type { ToolDef } from "./ava-mcp.js";
import { memoryPaths } from "../memory/paths.js";
import { writeFile, appendLine, readFile as readMemFile } from "../memory/store.js";
import { applyRefresh, applySupersede, serializeObservation, type Confidence } from "../memory/observations.js";
import { forgetLast, forgetMatch, forgetProject } from "../memory/forget.js";

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

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(["low", "medium", "high"]);

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
        if (file !== "observations") {
          return { ok: false, text: "refresh is only valid for file=observations" };
        }
        if (typeof args.supersedes === "string" && args.supersedes.length > 0) {
          return { ok: false, text: "refresh and supersedes are mutually exclusive" };
        }
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
      const rawConf = String(args.confidence ?? "low");
      if (!VALID_CONFIDENCE.has(rawConf)) {
        return { ok: false, text: `invalid confidence: ${rawConf}` };
      }
      const confidence = rawConf as Confidence;
      if (!text) return { ok: false, text: "missing text" };

      if (typeof args.supersedes === "string" && args.supersedes.length > 0) {
        const r = applySupersede(readMemFile(p.observations),
          { match: args.supersedes, today });
        if (r.changed) writeFile(p.observations, r.content);
      }

      const { rememberObservation } = await import("../memory/remember.js");
      rememberObservation({
        memoryDir: deps.memoryDir, category, confidence, text, today,
      });
      return { ok: true, text: "remembered (observation)" };
    },
  };
}

function buildMemoryForget(deps: MemoryToolDeps): ToolDef {
  return {
    tool: {
      name: "memory_forget",
      description:
        "Drop a memory entry. Use mode=last after Sir says 'forget that' shortly after a remember; mode=match for 'forget what I said about X' (returns ambiguous with candidates if more than one matches); mode=project for 'forget everything about project <slug>'.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["last", "match", "project"] },
          target: { type: "string", description: "Required for mode=match (substring) and mode=project (slug)." },
        },
        required: ["mode"],
      },
    },
    run: async (args) => {
      const mode = String(args.mode ?? "");
      const p = memoryPaths(deps.memoryDir);

      if (mode === "last") {
        const r = forgetLast({ paths: p });
        if (!r.dropped) return { ok: false, text: "no observations to forget" };
        return { ok: true, text: `dropped: ${r.dropped}` };
      }
      if (mode === "match") {
        const target = String(args.target ?? "").trim();
        if (!target) return { ok: false, text: "missing target" };
        const r = forgetMatch({ paths: p, target });
        if (r.status === "not_found") return { ok: false, text: "not found" };
        if (r.status === "ambiguous")
          return { ok: false, text: `ambiguous; candidates:\n${r.candidates.join("\n")}` };
        return { ok: true, text: `dropped: ${r.line}` };
      }
      if (mode === "project") {
        const slug = String(args.target ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        try {
          const r = forgetProject({ paths: p, slug });
          return { ok: true, text: `dropped project ${slug}; file removed: ${r.removedFile}` };
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      }
      return { ok: false, text: `unknown mode: ${mode}` };
    },
  };
}

export function buildMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  return [buildMemoryRead(deps), buildMemoryRemember(deps), buildMemoryForget(deps)];
}
