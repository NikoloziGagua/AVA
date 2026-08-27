import { config as loadDotEnv } from "dotenv";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve configuration from the repository layout, never from process.cwd().
// npm workspaces and PM2 launch with cwd=server, while `node server/dist/index.js`
// is commonly run from the repository root. The old cwd-relative behaviour made
// those two commands use different .env files and different data/memory stores.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(moduleDir, "..");
const repoDir = resolve(serverDir, "..");

// A server-local file is the most specific configuration. The checked-in
// .env.example lives at the repository root, so support a root .env as a
// fallback too. dotenv preserves real process environment variables.
loadDotEnv({
  path: [join(serverDir, ".env"), join(repoDir, ".env")],
  quiet: true,
});

export type Config = {
  port: number;
  bindAddr: string;
  dataDir: string;
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  pairingTtlMs: number;
  /** Hard upper bound for one approved Claude Code/Codex implementation run. */
  selfWorkerTimeoutMs: number;
  chromeProfileDir: string;
  chromeExecutablePath: string | null;
  chromeCdpUrl: string | null;
  screenshotDir: string;
  pidfileDir: string;
  logsDir: string;
  memoryDir: string;
  fsRoots: string[];
  repoRoot: string;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  llmProvider: "openai" | "anthropic";
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  /** Shopify Admin API — store domain (my-store.myshopify.com) + access token (shpat_…). */
  shopifyStore: string | null;
  shopifyAdminToken: string | null;
  /** Google Places API (New) key — for the find_places tool. */
  googlePlacesApiKey: string | null;
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

export function parseSelfWorkerTimeoutMs(raw: string | undefined): number {
  const minutes = Number(raw ?? 60);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    throw new Error(
      `invalid SELF_WORKER_TIMEOUT_MINUTES: ${raw} (expected a number from 1 to 120)`,
    );
  }
  return Math.round(minutes * 60_000);
}

function resolveFromServer(raw: string): string {
  return isAbsolute(raw) ? resolve(raw) : resolve(serverDir, raw);
}

export function loadConfig(): Config {
  // Relative runtime paths are anchored to server/, matching the documented
  // production location (server/data) regardless of the launch command's cwd.
  const dataDir = resolveFromServer(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  const chromeProfileDir = process.env.CHROME_PROFILE_DIR
    ? resolveFromServer(process.env.CHROME_PROFILE_DIR)
    : join(dataDir, "chrome-profile");
  const screenshotDir = process.env.SCREENSHOT_DIR
    ? resolveFromServer(process.env.SCREENSHOT_DIR)
    : join(dataDir, "screenshots");
  const pidfileDir = process.env.PIDFILE_DIR
    ? resolveFromServer(process.env.PIDFILE_DIR)
    : join(dataDir, "pidfiles");
  const logsDir = process.env.LOGS_DIR
    ? resolveFromServer(process.env.LOGS_DIR)
    : join(dataDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const memoryDir = process.env.MEMORY_DIR
    ? resolveFromServer(process.env.MEMORY_DIR)
    : join(dataDir, "memory");
  const fsRoots = (process.env.FS_ROOTS ?? "C:/ai/**,C:/projects/**,C:/Users/nikug/**")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rawProvider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
  const llmProvider: "openai" | "anthropic" = rawProvider === "anthropic" ? "anthropic" : "openai";
  return {
    port: parsePort(process.env.PORT),
    bindAddr: process.env.TAILSCALE_IP ?? "127.0.0.1",
    dataDir,
    dbPath: join(dataDir, "state.db"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    pairingTtlMs: parsePairingTtlMs(process.env.AUTH_PAIRING_TTL_SECONDS),
    selfWorkerTimeoutMs: parseSelfWorkerTimeoutMs(process.env.SELF_WORKER_TIMEOUT_MINUTES),
    chromeProfileDir,
    chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH
      ? resolveFromServer(process.env.CHROME_EXECUTABLE_PATH)
      : null,
    chromeCdpUrl: process.env.CHROME_CDP_URL?.trim() || null,
    screenshotDir,
    pidfileDir,
    logsDir,
    memoryDir,
    fsRoots,
    repoRoot: process.env.AVA_REPO_ROOT
      ? resolveFromServer(process.env.AVA_REPO_ROOT)
      : repoDir,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    llmProvider,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? null,
    shopifyStore: process.env.SHOPIFY_STORE ?? null,
    shopifyAdminToken: process.env.SHOPIFY_ADMIN_TOKEN ?? null,
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? null,
  };
}
