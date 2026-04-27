import { promises as fsp } from "node:fs";
import { buildPathAllowlist } from "../security/path-allowlist.js";

export type FsResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

export type FilesystemConfig = { roots: string[] };

export type Filesystem = {
  read: (path: string) => Promise<FsResult<{ content: string }>>;
  write: (path: string, content: string) => Promise<FsResult<Record<never, never>>>;
  list: (
    path: string,
  ) => Promise<FsResult<{ entries: Array<{ name: string; isDir: boolean }> }>>;
  stat: (
    path: string,
  ) => Promise<FsResult<{ size: number; mtimeMs: number; isDir: boolean }>>;
  delete: (path: string) => Promise<FsResult<Record<never, never>>>;
};

export function buildFilesystem(cfg: FilesystemConfig): Filesystem {
  const check = buildPathAllowlist({ roots: cfg.roots });

  return {
    async read(path) {
      const dec = check(path);
      if (!dec.ok) return { ok: false, reason: dec.reason };
      try {
        const content = await fsp.readFile(path, "utf8");
        return { ok: true, content };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async write(path, content) {
      const dec = check(path);
      if (!dec.ok) return { ok: false, reason: dec.reason };
      try {
        await fsp.writeFile(path, content, "utf8");
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async list(path) {
      const dec = check(path);
      if (!dec.ok) return { ok: false, reason: dec.reason };
      try {
        const items = await fsp.readdir(path, { withFileTypes: true });
        return {
          ok: true,
          entries: items.map((d) => ({ name: d.name, isDir: d.isDirectory() })),
        };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async stat(path) {
      const dec = check(path);
      if (!dec.ok) return { ok: false, reason: dec.reason };
      try {
        const s = await fsp.stat(path);
        return { ok: true, size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async delete(path) {
      const dec = check(path);
      if (!dec.ok) return { ok: false, reason: dec.reason };
      try {
        await fsp.rm(path, { recursive: false, force: false });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
  };
}
