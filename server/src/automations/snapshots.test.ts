import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { buildOperationsBriefSnapshot } from "./snapshots.js";

const readiness = { generatedAt: 1, generatedAtIso: "1970-01-01T00:00:00.001Z", ready: true, provider: "openai", core: { brainReady: true,
  voiceReady: true, browserReady: true, memoryReady: true }, counts: { preferences: 0, observations: 0,
  projects: 0, people: 0, playbooks: 0, watches: 0 }, integrations: { instagram: false, whatsapp: false,
  shopify: false, googlePlaces: false, screenVision: false, push: false, microsoftUfoAvailable: false } };

describe("operations-brief snapshot", () => {
  it("contains bounded aggregate facts without copying source content", () => {
    const db = openInMemoryDb();
    const now = 2_000_000_000_000;
    db.prepare(`INSERT INTO sessions (id,title,created_at,updated_at) VALUES ('s','Sensitive title',?,?)`).run(now, now);
    db.prepare(`INSERT INTO approvals (id,session_id,tool,args,summary,status,created_at)
      VALUES ('a','s','shell','{"secret":"sk-live-abcdefghijklmnopqrstuvwxyz"}','Sensitive approval','pending',?)`).run(now);
    db.prepare(`INSERT INTO notes (id,title,content,status,pinned,created_at,updated_at)
      VALUES ('n','Private title','Private body','doing',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO self_improvements (id,created_at,trigger,goal,status,outcome)
      VALUES ('i',?,'manual','Private goal','blocked',NULL)`).run(now);
    db.prepare(`INSERT INTO watches (id,prompt,interval_minutes,once,enabled,created_at,successor_status)
      VALUES ('w','Private watcher',5,1,1,?, 'blocked')`).run(now);
    db.prepare(`INSERT INTO observability_runs (id,trace_id,run_kind,runtime_id,runtime_type,owner_type,title,status,
      verification_status,privacy_level,retention_class,version,started_at,updated_at,last_event_at,stale_after_ms,
      detailed_expires_at,compact_expires_at)
      VALUES ('r','t','chat_agent','ava','ava','ava','Private run','failed','not_verified','personal','detail_30d',1,
        ?,?,?,60000,?,?)`).run(now, now, now, now + 1_000, now + 2_000);

    const snapshot = buildOperationsBriefSnapshot(db, readiness, now);
    expect(snapshot).toMatchObject({
      windowHours: 24,
      recentRuns: { total: 1, failed: 1, notVerified: 1 },
      attention: { pendingApprovals: 1, blockedSelfImprovements: 1, blockedWatcherSuccessors: 1 },
      work: { pinnedNotes: 1, notesDoing: 1, enabledWatches: 1 },
    });
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toMatch(/Sensitive|Private|sk-live/);
    db.close();
  });
});
