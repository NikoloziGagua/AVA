import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "./db.js";
import { createSession, setStatus, listByStatus } from "./sessions.js";
import { listMessages } from "./messages.js";
import { PidfileRegistry } from "../process/pidfile.js";
import { runRecovery } from "./recovery.js";

let dir: string;
let db: Db;
let pidfiles: PidfileRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-rec-"));
  db = openDb(join(dir, "x.db"));
  pidfiles = new PidfileRegistry(join(dir, "pidfiles"));
});

describe("runRecovery", () => {
  it("kills orphaned worker pids from previous runs and clears the registry", async () => {
    pidfiles.add("oldRun", 12345);
    pidfiles.add("oldRun", 67890);
    const killed: number[] = [];
    await runRecovery({
      db,
      pidfiles,
      kill: async (pid) => { killed.push(pid); return true; },
    });
    expect(killed.sort()).toEqual([12345, 67890]);
    expect(pidfiles.listAll()).toEqual([]);
  });

  it("marks all active sessions as interrupted with a system message", async () => {
    const a = createSession(db, { title: "a" });
    const b = createSession(db, { title: "b" });
    await runRecovery({ db, pidfiles, kill: async () => true });
    const interrupted = listByStatus(db, "interrupted").map((s) => s.id).sort();
    expect(interrupted).toEqual([a.id, b.id].sort());
    const aMsgs = listMessages(db, a.id);
    expect(aMsgs.at(-1)?.role).toBe("system");
    expect(aMsgs.at(-1)?.content).toMatch(/server restarted/i);
  });

  it("does not touch idle or archived sessions", async () => {
    const s = createSession(db, { title: "idle one" });
    setStatus(db, s.id, "idle");
    await runRecovery({ db, pidfiles, kill: async () => true });
    expect(listByStatus(db, "interrupted")).toEqual([]);
  });

  it("continues even if kill throws for one of the pids", async () => {
    pidfiles.add("r", 1);
    pidfiles.add("r", 2);
    let calls = 0;
    await runRecovery({
      db,
      pidfiles,
      kill: async () => {
        calls++;
        if (calls === 1) throw new Error("nope");
        return true;
      },
    });
    expect(calls).toBe(2);
    expect(pidfiles.listAll()).toEqual([]);
  });
});
