import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "./db.js";
import { createSession } from "./sessions.js";
import {
  createApproval, getApproval, listPendingForSession, decide,
  expirePending, waitForDecision, approvalEvents,
} from "./approvals.js";

let db: Db;
let sessionId: string;
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "ava-app-")), "x.db"));
  sessionId = createSession(db, { title: "t" }).id;
});

describe("approvals repo", () => {
  it("createApproval + getApproval round-trip; default status pending", () => {
    const approval = createApproval(db, {
      sessionId,
      tool: "bash",
      args: { cmd: "ls" },
      summary: "List files",
    });
    expect(approval.status).toBe("pending");
    expect(approval.decided_at).toBeNull();

    const fetched = getApproval(db, approval.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(approval.id);
    expect(fetched!.session_id).toBe(sessionId);
    expect(fetched!.tool).toBe("bash");
    expect(fetched!.args).toBe(JSON.stringify({ cmd: "ls" }));
    expect(fetched!.summary).toBe("List files");
    expect(fetched!.status).toBe("pending");
    expect(fetched!.decided_at).toBeNull();
  });

  it("listPendingForSession returns only pending rows for that session ordered by created_at ASC", () => {
    const a1 = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "first" });
    const a2 = createApproval(db, { sessionId, tool: "read", args: {}, summary: "second" });

    // Create an approval for a different session — should not appear.
    const otherId = createSession(db, { title: "other" }).id;
    createApproval(db, { sessionId: otherId, tool: "bash", args: {}, summary: "other" });

    // Decide a2 — should not appear in pending list.
    decide(db, a2.id, "approved");

    const pending = listPendingForSession(db, sessionId);
    expect(pending.length).toBe(1);
    expect(pending[0]!.id).toBe(a1.id);
  });

  it("listPendingForSession returns rows ordered by created_at ASC", () => {
    const a1 = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "first" });
    const a2 = createApproval(db, { sessionId, tool: "read", args: {}, summary: "second" });
    const pending = listPendingForSession(db, sessionId);
    expect(pending.length).toBe(2);
    expect(pending[0]!.id).toBe(a1.id);
    expect(pending[1]!.id).toBe(a2.id);
    expect(pending[0]!.created_at).toBeLessThanOrEqual(pending[1]!.created_at);
  });

  it("decide('approved') flips status, returns true; second decide returns false", () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });

    const first = decide(db, approval.id, "approved");
    expect(first).toBe(true);

    const updated = getApproval(db, approval.id);
    expect(updated!.status).toBe("approved");
    expect(updated!.decided_at).not.toBeNull();

    const second = decide(db, approval.id, "denied");
    expect(second).toBe(false);
    // Status must not have changed.
    expect(getApproval(db, approval.id)!.status).toBe("approved");
  });

  it("decide emits the 'decided' event with the right payload", async () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });

    const got = new Promise((r) => approvalEvents.once("decided", r));
    decide(db, approval.id, "approved");
    const event = await got;
    expect(event).toEqual({ id: approval.id, status: "approved" });
  });

  it("waitForDecision resolves when decide() is called", async () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });

    setTimeout(() => decide(db, approval.id, "approved"), 30);

    const result = await waitForDecision(db, approval.id, 1000);
    expect(result.status).toBe("approved");
  });

  it("waitForDecision times out and resolves with 'expired'; row status is 'expired' in DB", async () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });

    const result = await waitForDecision(db, approval.id, 50);
    expect(result.status).toBe("expired");

    const row = getApproval(db, approval.id);
    expect(row!.status).toBe("expired");
    expect(row!.decided_at).not.toBeNull();
  });

  it("waitForDecision resolves immediately if approval already decided", async () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });
    decide(db, approval.id, "denied");

    const result = await waitForDecision(db, approval.id, 1000);
    expect(result.status).toBe("denied");
  });

  it("expirePending(olderThanMs) flips old pending rows to expired", () => {
    const approval = createApproval(db, { sessionId, tool: "bash", args: {}, summary: "s" });

    // Should not expire rows created just now.
    const count0 = expirePending(db, 60_000);
    expect(count0).toBe(0);
    expect(getApproval(db, approval.id)!.status).toBe("pending");

    // Manually backdate created_at to simulate old row.
    db.prepare("UPDATE approvals SET created_at = ? WHERE id = ?").run(Date.now() - 100_000, approval.id);

    const count1 = expirePending(db, 60_000);
    expect(count1).toBe(1);
    expect(getApproval(db, approval.id)!.status).toBe("expired");
  });
});
