// server/src/tools/filesystem-mcp.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Filesystem } from "./filesystem.js";

const MAX_TEXT = 8192;
function truncate(s: string): string {
  if (s.length <= MAX_TEXT) return s;
  return s.slice(0, MAX_TEXT) + `\n... [truncated, ${s.length - MAX_TEXT} more chars]`;
}

export type FsToolEvent =
  | { kind: "fs.call"; tool: string; args: unknown }
  | { kind: "fs.result"; tool: string; ok: boolean; result: string };

export type FsToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
};

export function buildFilesystemTools(opts: {
  fs: Filesystem;
  emit: (e: FsToolEvent) => void;
}): FsToolDef[] {
  const { fs, emit } = opts;

  const wrap = (name: string, run: FsToolDef["run"]): FsToolDef["run"] => {
    return async (args) => {
      emit({ kind: "fs.call", tool: name, args });
      const r = await run(args);
      emit({ kind: "fs.result", tool: name, ok: r.ok, result: r.text });
      return r;
    };
  };

  return [
    {
      tool: {
        name: "fs_read",
        description:
          "Read a UTF-8 text file. Path must be absolute and within an allowlisted root. .env files are blocked.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      run: wrap("fs_read", async (args) => {
        const path = String(args.path ?? "");
        const r = await fs.read(path);
        if (r.ok) return { ok: true, text: truncate(r.content) };
        return { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "fs_write",
        description:
          "Write UTF-8 text to a file (overwrites if exists). Path must be allowlisted; .env blocked.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      run: wrap("fs_write", async (args) => {
        const r = await fs.write(String(args.path ?? ""), String(args.content ?? ""));
        return r.ok ? { ok: true, text: "written" } : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "fs_list",
        description: "List entries of a directory (one level, name + isDir).",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      run: wrap("fs_list", async (args) => {
        const r = await fs.list(String(args.path ?? ""));
        if (r.ok)
          return {
            ok: true,
            text: r.entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n"),
          };
        return { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "fs_stat",
        description: "Stat a file or directory: size (bytes), mtimeMs, isDir.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      run: wrap("fs_stat", async (args) => {
        const r = await fs.stat(String(args.path ?? ""));
        if (r.ok)
          return {
            ok: true,
            text: `size=${r.size} mtimeMs=${r.mtimeMs} isDir=${r.isDir}`,
          };
        return { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "fs_delete",
        description:
          "Delete a single file or empty directory. High-risk; gated by approval policy in M3+.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      run: wrap("fs_delete", async (args) => {
        const r = await fs.delete(String(args.path ?? ""));
        return r.ok ? { ok: true, text: "deleted" } : { ok: false, text: `error: ${r.reason}` };
      }),
    },
  ];
}
