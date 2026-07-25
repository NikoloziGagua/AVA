import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import {
  cancelExplorerTaskIfRunning,
  createExplorerTask,
  getExplorerTask,
  listExplorerTasks,
  markStaleExplorerTasksInterrupted,
  recordExplorerAgentEvent,
} from "./store.js";

describe("Explorer execution store", () => {
  it("records real operational events, durations and capability links with secrets scrubbed", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Send a message" });
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";

    createExplorerTask(db, {
      id: "run-1",
      sessionId: session.id,
      originalRequest: `send it; password is hunter2; key=${secret}`,
      mode: "action",
      startedAt: 1_000,
    });
    recordExplorerAgentEvent(db, "run-1", {
      kind: "thought",
      payload: { text: "private model reasoning must not be persisted" },
    }, { at: 1_010 });
    recordExplorerAgentEvent(db, "run-1", {
      kind: "tool_call",
      payload: {
        tool: "instagram_send_dm",
        args: { recipient: "Lasha", password: "hunter2" },
      },
    }, { at: 1_100 });
    recordExplorerAgentEvent(db, "run-1", {
      kind: "tool_result",
      payload: {
        tool: "instagram_send_dm",
        ok: true,
        result: `sent with ${secret}`,
      },
    }, { at: 1_350, durationMs: 250 });
    recordExplorerAgentEvent(db, "run-1", {
      kind: "final",
      payload: { text: `Done. token: ${secret}` },
    }, { at: 1_500 });

    const task = getExplorerTask(db, "run-1")!;
    const serialised = JSON.stringify(task);
    expect(task.status).toBe("finished");
    expect(task.outcome).toBe("finished_unverified");
    expect(task.durationMs).toBe(500);
    expect(task.toolCallCount).toBe(1);
    expect(task.capabilityIds).toEqual(expect.arrayContaining([
      "conversation.text-turn",
      "instagram.send-dm",
      "instagram.messaging",
      "browser.persistent-control",
    ]));
    expect(task.verification.status).toBe("not_recorded");
    expect(task.events.map((event) => event.type)).toEqual([
      "task_created",
      "tool_call_started",
      "tool_call_completed",
      "final_response",
    ]);
    expect(task.events[2]!.durationMs).toBe(250);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("AbCdEf0123456789");
    expect(serialised).not.toContain("private model reasoning");
    expect(serialised).toContain("***");
    db.close();
  });

  it("does not manufacture tasks from legacy sessions", () => {
    const db = openInMemoryDb();
    createSession(db, { title: "Legacy conversation" });
    expect(listExplorerTasks(db)).toEqual([]);
    db.close();
  });

  it("retains execution history when its chat session is permanently deleted", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Disposable chat" });
    createExplorerTask(db, {
      id: "retained-run",
      sessionId: session.id,
      originalRequest: "inspect something",
      mode: "action",
      startedAt: 10,
    });

    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    const task = getExplorerTask(db, "retained-run")!;
    expect(task.sessionId).toBeNull();
    expect(task.sessionTitle).toBeNull();
    expect(task.originalRequest).toBe("inspect something");
    db.close();
  });

  it("appends an interruption event and closes runs orphaned by restart", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Interrupted" });
    createExplorerTask(db, {
      id: "orphan",
      sessionId: session.id,
      originalRequest: "long task",
      mode: "action",
      startedAt: 100,
    });

    expect(markStaleExplorerTasksInterrupted(db, 900)).toBe(1);
    const task = getExplorerTask(db, "orphan")!;
    expect(task.status).toBe("interrupted");
    expect(task.outcome).toBe("interrupted");
    expect(task.completedAt).toBe(900);
    expect(task.events.at(-1)?.type).toBe("task_interrupted");
    expect(markStaleExplorerTasksInterrupted(db, 1_000)).toBe(0);
    db.close();
  });

  it("never persists approval argument payloads", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Approval" });
    createExplorerTask(db, {
      id: "approval-run",
      sessionId: session.id,
      originalRequest: "login",
      mode: "action",
    });
    recordExplorerAgentEvent(db, "approval-run", {
      kind: "approval_required",
      payload: {
        id: "approval-1",
        tool: "instagram_login",
        args: { username: "nika", password: "never-store-this" },
        summary: "Log in to Instagram",
      },
    });

    const raw = db.prepare(
      "SELECT sanitised_input FROM explorer_events WHERE task_id = ? AND type = 'approval_required'",
    ).get("approval-run") as { sanitised_input: string };
    expect(raw.sanitised_input).not.toContain("never-store-this");
    expect(raw.sanitised_input).not.toContain("password");
    db.close();
  });

  it("scrubs raw cookies and auth headers from arbitrary tool output before storage and on read", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "HTTP failure" });
    createExplorerTask(db, {
      id: "header-run",
      sessionId: session.id,
      originalRequest: "inspect the failed request",
      mode: "action",
    });
    recordExplorerAgentEvent(db, "header-run", {
      kind: "tool_call",
      payload: {
        tool: "shell",
        args: {
          command: "inspect",
          request: {
            headers: {
              authorization: "Basic structured-secret",
              cookie: "sid=structured-cookie",
              "x-api-key": "structured-key",
              accept: "application/json",
            },
          },
        },
      },
    });
    recordExplorerAgentEvent(db, "header-run", {
      kind: "tool_result",
      payload: {
        tool: "shell",
        ok: false,
        result: [
          "status: 401",
          "Authorization: Basic output-secret",
          "Cookie: sid=output-cookie; csrf=output-csrf",
          "Set-Cookie: sid=output-set-cookie; HttpOnly",
          "Content-Type: application/json",
          "body: unauthorised",
          "-----BEGIN RSA PRIVATE KEY-----",
          "c3VwZXItc2VjcmV0LXByaXZhdGUta2V5LWJvZHk=",
          "-----END RSA PRIVATE KEY-----",
        ].join("\n"),
      },
    });

    const rows = db.prepare(`
      SELECT sanitised_input, sanitised_output
      FROM explorer_events
      WHERE task_id = ? AND type IN ('tool_call_started', 'tool_call_completed')
      ORDER BY sequence
    `).all("header-run") as Array<{
      sanitised_input: string | null;
      sanitised_output: string | null;
    }>;
    const persisted = JSON.stringify(rows);
    const returned = JSON.stringify(getExplorerTask(db, "header-run"));
    for (const unsafe of [
      "structured-secret",
      "structured-cookie",
      "structured-key",
      "output-secret",
      "output-cookie",
      "output-csrf",
      "output-set-cookie",
      "c3VwZXItc2VjcmV0LXByaXZhdGUta2V5LWJvZHk",
    ]) {
      expect(persisted).not.toContain(unsafe);
      expect(returned).not.toContain(unsafe);
    }
    expect(returned).toContain("application/json");
    expect(returned).toContain("unauthorised");
    expect(persisted).toContain("private key redacted");
    db.close();
  });

  it("re-scrubs unsafe legacy rows and session titles at the read boundary", () => {
    const db = openInMemoryDb();
    const session = createSession(db, {
      title: "Authorization: Basic title-secret",
    });
    createExplorerTask(db, {
      id: "defence-in-depth",
      sessionId: session.id,
      originalRequest: "inspect",
      mode: "action",
    });
    recordExplorerAgentEvent(db, "defence-in-depth", {
      kind: "tool_result",
      payload: { tool: "shell", ok: false, result: "initial safe result" },
    });
    // Simulate a record created before the strengthened firewall.
    db.prepare(`
      UPDATE explorer_events
      SET sanitised_output = ?
      WHERE task_id = ? AND type = 'tool_call_completed'
    `).run(
      JSON.stringify(
        "Authorization: Basic legacy-auth-secret\n" +
        "Cookie: sid=legacy-cookie-secret\n" +
        "body: still useful",
      ),
      "defence-in-depth",
    );

    const returned = JSON.stringify(getExplorerTask(db, "defence-in-depth"));
    expect(returned).not.toContain("title-secret");
    expect(returned).not.toContain("legacy-auth-secret");
    expect(returned).not.toContain("legacy-cookie-secret");
    expect(returned).toContain("body: still useful");
    db.close();
  });

  it("does not persist inline shell credentials in the raw event row", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Shell credential check" });
    createExplorerTask(db, {
      id: "shell-secret-run",
      sessionId: session.id,
      originalRequest: "inspect a protected endpoint",
      mode: "action",
    });
    recordExplorerAgentEvent(db, "shell-secret-run", {
      kind: "tool_call",
      payload: {
        tool: "shell",
        args: {
          command:
            "API_TOKEN=env-value curl --cookie 'sid=cookie-value' " +
            "--password password-value https://user:url-value@example.test",
        },
      },
    });

    const raw = db.prepare(`
      SELECT sanitised_input
      FROM explorer_events
      WHERE task_id = ? AND type = 'tool_call_started'
    `).get("shell-secret-run") as { sanitised_input: string };
    expect(raw.sanitised_input).not.toMatch(
      /env-value|cookie-value|password-value|url-value/,
    );
    expect(raw.sanitised_input).toContain("example.test");
    db.close();
  });

  it("records cancellation exactly once when the kill route is followed by killed and done events", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Cancel once" });
    createExplorerTask(db, {
      id: "cancel-run",
      sessionId: session.id,
      originalRequest: "stop this",
      mode: "action",
    });

    expect(cancelExplorerTaskIfRunning(db, "cancel-run", 100)).toBe(true);
    expect(recordExplorerAgentEvent(db, "cancel-run", {
      kind: "killed",
      payload: { reason: "manual" },
    }, { at: 110 })).toBeNull();
    expect(recordExplorerAgentEvent(db, "cancel-run", {
      kind: "done",
      payload: {},
    }, { at: 120 })).toBeNull();

    const task = getExplorerTask(db, "cancel-run")!;
    expect(task.status).toBe("cancelled");
    expect(task.outcome).toBe("cancelled_by_user");
    expect(task.events.filter((event) => event.type === "task_cancelled")).toHaveLength(1);
    db.close();
  });
});
