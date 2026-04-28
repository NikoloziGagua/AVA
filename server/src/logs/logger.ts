import pino, { type LoggerOptions } from "pino";
import pinoRoll from "pino-roll";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { scrubSecrets } from "../security/scrub.js";

export type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  flush: () => Promise<void>;
};

export type LoggerConfig = {
  level: "debug" | "info" | "warn" | "error";
  dir: string;
};

function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return scrubSecrets(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out;
  }
  return value;
}

export async function buildLogger(cfg: LoggerConfig): Promise<Logger> {
  mkdirSync(cfg.dir, { recursive: true });

  // pino-roll v4 default export returns a Promise<SonicBoom>.
  // Filenames follow pino-roll's convention: "<base>.<date>.<n>.<ext>",
  // e.g. "server.2026-04-28.1.log". Daily rotation creates a new file when
  // the date rolls over.
  const stream = (await (pinoRoll as unknown as (
    opts: Record<string, unknown>,
  ) => Promise<NodeJS.WritableStream & { flushSync?: () => void }>)({
    file: join(cfg.dir, "server"),
    frequency: "daily",
    dateFormat: "yyyy-MM-dd",
    extension: ".log",
    mkdir: true,
  })) as NodeJS.WritableStream & { flushSync?: () => void };

  const options: LoggerOptions = {
    level: cfg.level,
    formatters: {
      log: (obj) => scrubDeep(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const next = args.map((a) => (typeof a === "string" ? scrubSecrets(a) : a));
        return method.apply(this, next as Parameters<typeof method>);
      },
    },
  };

  const inner = pino(options, stream);

  const wrap =
    (level: "info" | "warn" | "error" | "debug") =>
    (...args: unknown[]) => {
      const [first, ...rest] = args;
      if (first && typeof first === "object") {
        inner[level](first as object, ...(rest as [string?, ...unknown[]]));
      } else {
        inner[level](first as string, ...(rest as unknown[]));
      }
    };

  return {
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    debug: wrap("debug"),
    flush: () =>
      new Promise<void>((resolve) => {
        inner.flush(() => {
          // pino's flush only drains pino's own buffer; the underlying
          // SonicBoom stream from pino-roll has its own buffer. Force a sync
          // drain to ensure bytes are on disk before resolving.
          if (typeof stream.flushSync === "function") {
            try {
              stream.flushSync();
            } catch {
              // ignore
            }
          }
          setTimeout(() => resolve(), 50);
        });
      }),
  };
}
