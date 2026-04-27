import express from "express";
import pino from "pino";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openDb } from "./state/db.js";
import { issuePairingCode } from "./auth/pairing.js";
import { requireToken } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { healthRoutes } from "./routes/health.js";
import { statusRoutes } from "./routes/status.js";
import { ActiveRuns } from "./orchestrator/active-runs.js";
import { startSystray } from "./systray/index.js";
import { PidfileRegistry } from "./process/pidfile.js";
import { buildChrome } from "./tools/chrome.js";

const startedAt = Date.now();
const cfg = loadConfig();
const log = pino({ level: cfg.logLevel });
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

const agentDeps = {
  pidfiles,
  fsRoots: cfg.fsRoots,
  getChrome,
};

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRoutes(startedAt));
app.use("/api/auth", authRoutes(db, requireToken(db)));
app.use("/api/chat", chatRoutes(db, runs, requireToken(db), agentDeps));
app.use("/", statusRoutes({ db, runs, startedAt }));

const webDistDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
app.use("/", express.static(webDistDir));

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
