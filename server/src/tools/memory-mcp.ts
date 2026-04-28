import type { ToolDef } from "./ava-mcp.js";
import { memoryPaths } from "../memory/paths.js";
import { readFile } from "../memory/store.js";

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
      if (file === "preferences") return { ok: true, text: readFile(p.preferences) };
      if (file === "observations") return { ok: true, text: readFile(p.observations) };
      if (file === "project") {
        const slug = String(args.project ?? "").trim();
        if (!slug) return { ok: false, text: "missing project slug" };
        try {
          return { ok: true, text: readFile(p.projectFile(slug)) };
        } catch (e) {
          return { ok: false, text: e instanceof Error ? e.message : String(e) };
        }
      }
      if (file === "all") {
        const parts = [
          readFile(p.memoryIndex),
          readFile(p.preferences),
          readFile(p.observations),
        ].filter((s) => s.length > 0);
        return { ok: true, text: parts.join("\n---\n") };
      }
      return { ok: false, text: `unknown file: ${file}` };
    },
  };
}

export function buildMemoryTools(deps: MemoryToolDeps): ToolDef[] {
  return [buildMemoryRead(deps)];
}
