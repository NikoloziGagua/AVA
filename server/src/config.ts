import "dotenv/config";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type Config = {
  port: number;
  bindAddr: string;
  dataDir: string;
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  pairingTtlMs: number;
  chromeProfileDir: string;
  screenshotDir: string;
  pidfileDir: string;
  logsDir: string;
  fsRoots: string[];
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
};

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid PORT: ${raw}`);
  }
  return port;
}

function parseLogLevel(raw: string | undefined): Config["logLevel"] {
  const value = raw ?? "info";
  if (!(LOG_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`invalid LOG_LEVEL: ${raw} (expected one of ${LOG_LEVELS.join(", ")})`);
  }
  return value as Config["logLevel"];
}

function parsePairingTtlMs(raw: string | undefined): number {
  const seconds = Number(raw ?? 300);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`invalid AUTH_PAIRING_TTL_SECONDS: ${raw}`);
  }
  return seconds * 1000;
}

export function loadConfig(): Config {
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  const chromeProfileDir = resolve(process.env.CHROME_PROFILE_DIR ?? join(dataDir, "chrome-profile"));
  const screenshotDir = resolve(process.env.SCREENSHOT_DIR ?? join(dataDir, "screenshots"));
  const pidfileDir = resolve(process.env.PIDFILE_DIR ?? join(dataDir, "pidfiles"));
  const logsDir = resolve(process.env.LOGS_DIR ?? join(dataDir, "logs"));
  mkdirSync(logsDir, { recursive: true });
  const fsRoots = (process.env.FS_ROOTS ?? "C:/ai/**,C:/projects/**,C:/Users/nikug/Downloads/**")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: parsePort(process.env.PORT),
    bindAddr: process.env.TAILSCALE_IP ?? "127.0.0.1",
    dataDir,
    dbPath: join(dataDir, "state.db"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    pairingTtlMs: parsePairingTtlMs(process.env.AUTH_PAIRING_TTL_SECONDS),
    chromeProfileDir,
    screenshotDir,
    pidfileDir,
    logsDir,
    fsRoots,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? null,
  };
}
