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
};

export function loadConfig(): Config {
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  return {
    port: Number(process.env.PORT ?? 8787),
    bindAddr: process.env.TAILSCALE_IP ?? "127.0.0.1",
    dataDir,
    dbPath: join(dataDir, "state.db"),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",
    pairingTtlMs: Number(process.env.AUTH_PAIRING_TTL_SECONDS ?? 300) * 1000,
  };
}
