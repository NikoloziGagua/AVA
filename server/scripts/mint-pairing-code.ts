import { loadConfig } from "../src/config.js";
import { openDb } from "../src/state/db.js";
import { issuePairingCode } from "../src/auth/pairing.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const code = issuePairingCode(db, cfg.pairingTtlMs);
console.log(code);
