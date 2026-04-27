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

const startedAt = Date.now();
const cfg = loadConfig();
const log = pino({ level: cfg.logLevel });
const db = openDb(cfg.dbPath);
const runs = new ActiveRuns();

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRoutes(startedAt));
app.use("/api/auth", authRoutes(db, requireToken(db)));
app.use("/api/chat", chatRoutes(db, runs, requireToken(db)));
app.use("/", statusRoutes({ db, runs, startedAt }));

const webDistDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
app.use("/", express.static(webDistDir));

app.listen(cfg.port, cfg.bindAddr, () => {
  log.info({ port: cfg.port, bind: cfg.bindAddr }, "ava server listening");
});

startSystray({
  onPair: () => issuePairingCode(db, cfg.pairingTtlMs),
  log,
});
