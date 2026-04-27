import picomatch from "picomatch";
import { resolve, normalize } from "node:path";

export type AllowDecision = { ok: true } | { ok: false; reason: string };

export type AllowlistConfig = {
  roots: string[];
};

const ENV_PATTERN = /(^|[\\/])[^\\/]*\.env(\.[^\\/]*)?$/i;

export function buildPathAllowlist(cfg: AllowlistConfig): (absPath: string) => AllowDecision {
  const matchers = cfg.roots.map((root) =>
    picomatch(root.replace(/\\/g, "/"), { nocase: true, dot: true }),
  );

  return (absPath: string): AllowDecision => {
    const resolved = normalize(resolve(absPath)).replace(/\\/g, "/");

    if (ENV_PATTERN.test(resolved)) {
      return { ok: false, reason: `path matches .env hard-block: ${resolved}` };
    }
    for (const m of matchers) {
      if (m(resolved)) return { ok: true };
    }
    return { ok: false, reason: `path not in allowlist: ${resolved}` };
  };
}
