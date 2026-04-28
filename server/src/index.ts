import express from "express";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { buildLogger } from "./logs/logger.js";
import { openDb } from "./state/db.js";
import { issuePairingCode } from "./auth/pairing.js";
import { requireToken } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { healthRoutes } from "./routes/health.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { statusRoutes } from "./routes/status.js";
import { ActiveRuns } from "./orchestrator/active-runs.js";
import { startSystray } from "./systray/index.js";
import { PidfileRegistry } from "./process/pidfile.js";
import { buildChrome } from "./tools/chrome.js";

const startedAt = Date.now();
const cfg = loadConfig();
const log = await buildLogger({ level: cfg.logLevel, dir: cfg.logsDir });
const db = openDb(cfg.dbPath);
const runs = new ActiveRuns();
const pidfiles = new PidfileRegistry(cfg.pidfileDir);

let chromePromise: ReturnType<typeof buildChrome> | null = null;
function getChrome() {
  if (!chromePromise) {
    chromePromise = buildChrome({
      profileDir: cfg.chromeProfileDir,
      screenshotDir: cfg.screenshotDir,
    });
  }
  return chromePromise;
}
// Single-tenant by design: the persistent chromium context is shared across all
// chat runs in this process. Concurrent runs would race on the same active page;
// chat.ts blocks a second run within a session at line 42, but cross-session
// concurrency is not currently guarded. Fine for one user, one phone.

const agentDeps = {
  pidfiles,
  fsRoots: cfg.fsRoots,
  getChrome,
};

const anthropic = cfg.anthropicApiKey ? new Anthropic({ apiKey: cfg.anthropicApiKey }) : null;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRoutes(startedAt));
app.use("/api/auth", authRoutes(db, requireToken(db)));
app.use("/api/chat", chatRoutes(db, runs, requireToken(db), agentDeps, { anthropic }));
app.use("/api/sessions", sessionsRoutes(db, requireToken(db)));
app.use("/", statusRoutes({ db, runs, startedAt }));

const webDistDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
app.use("/", express.static(webDistDir));

let shuttingDown = false;
async function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, "shutting down");
  if (chromePromise) {
    try {
      const chrome = await chromePromise;
      await chrome.close();
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "chrome close failed");
    }
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app.listen(cfg.port, cfg.bindAddr, () => {
  log.info({ port: cfg.port, bind: cfg.bindAddr }, "ava server listening");
});

try {
  startSystray({
    onPair: () => issuePairingCode(db, cfg.pairingTtlMs),
    log,
  });
} catch (e) {
  log.warn(
    { err: e instanceof Error ? e.message : String(e) },
    "systray failed to start — server still running. Mint a pairing code with: npm -w server run pair",
  );
}
