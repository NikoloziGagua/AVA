// server/src/tools/filesystem-mcp.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Filesystem } from "./filesystem.js";
import { scrubSecrets } from "../security/scrub.js";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";

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
  run: (args: Record<string, unknown>) => Promise<{
    text: string;
    ok: boolean;
    verification?: ToolVerificationEvidence;
  }>;
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
        // Scrub secrets from file contents before the model sees them — the
        // same backstop every other tool applies. Covers the case where a secret
        // slips past the path hard-block (e.g. an unlisted credential file).
        if (!r.ok) return { ok: false, text: `error: ${r.reason}` };
        const clean = scrubSecrets(r.content);
        if (clean.length <= MAX_TEXT) return { ok: true, text: clean };
        // Truncated read = read-modify-write CORRUPTION hazard: writing this
        // partial content back with fs_write would silently destroy the rest of
        // the file. Make the danger explicit to the model.
        return {
          ok: true,
          text:
            clean.slice(0, MAX_TEXT) +
            `\n... [TRUNCATED at ${MAX_TEXT} chars — the file is LARGER than shown ` +
            `(${clean.length} chars total). Do NOT write this truncated content back ` +
            `with fs_write (it would destroy the rest of the file); use claude_code ` +
            `to edit large files.]`,
        };
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
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        const r = await fs.write(path, content);
        if (!r.ok) return { ok: false, text: `error: ${r.reason}` };
        // A successful write syscall is executor-reported success. Read back the
        // bytes through the same allowlisted filesystem boundary before emitting
        // task-outcome evidence. Raw content never enters the evidence payload.
        const readback = await fs.read(path);
        if (!readback.ok) {
          return {
            ok: true,
            text: `written; read-back verification unavailable: ${readback.reason}`,
            verification: {
              state: "unavailable",
              scope: "task_outcome",
              method: "fs_readback",
              summary: "The write returned successfully, but AVA could not read the file back.",
            },
          };
        }
        if (readback.content !== content) {
          return {
            ok: false,
            text: "error: write completed but read-back content did not match",
            verification: {
              state: "contradicted",
              scope: "task_outcome",
              method: "fs_readback",
              summary: "The bytes read back did not match the requested file content.",
            },
          };
        }
        return {
          ok: true,
          text: "written and verified by read-back",
          verification: {
            state: "verified",
            scope: "task_outcome",
            method: "fs_readback",
            summary: "The file was read back and its content matched exactly.",
          },
        };
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
