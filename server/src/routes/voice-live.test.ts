import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { openInMemoryDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { listMessages } from "../state/messages.js";
import { MemoryArchive } from "../memory-archive/archive.js";
import {
  startLiveSession, LIVE_MAX_PENDING_JOBS, LIVE_MAX_DELEGATION_IDS,
  LIVE_RESULT_HISTORY, LIVE_RESULT_CHARS, type LiveRunAction,
} from "./voice-live.js";

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  frames: Record<string, any>[] = [];
  send(value: string) { this.frames.push(JSON.parse(value)); }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.emit("close"); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const cleanups: Array<() => void> = [];
afterEach(async () => { cleanups.splice(0).forEach(fn => fn()); await tick(); });
async function fixture(run?: LiveRunAction) {
  const db = openInMemoryDb();
  const sessionId = createSession(db, { title: "Synthetic voice test", origin: "human" }).id;
  const client = new Socket(), upstream = new Socket();
  const calls = vi.fn<LiveRunAction>(run ?? (async () => ({ sessionId, text: "Saved fixture event cal_fixture." })));
  const started = startLiveSession({
    client: client as unknown as WebSocket, db,
    binding: { version: 1, sessionId, origin: "human", resolution: "resumed_exact" },
    apiKey: "not-a-real-key", instructions: "Synthetic fixture", runAction: calls,
    hello: () => JSON.stringify({ type: "ava.session", sessionId }),
    connect: () => upstream as unknown as WebSocket,
  });
  const emit = (e: unknown) => upstream.emit("message", Buffer.from(JSON.stringify(e)));
  const input = (text: string) => emit({ type: "session.input_transcript.delta", delta: text });
  const speak = (text: string) => emit({ type: "session.output_transcript.delta", delta: text });
  const delegate = (id: string) => emit({ type: "session.delegation.created", delegation: { target: "client", id } });
  const control = (e: unknown) => client.emit("message", Buffer.from(JSON.stringify(e)), false);
  upstream.emit("open"); emit({ type: "session.started" }); await started;
  cleanups.push(() => { client.close(); upstream.close(); db.close(); });
  return { db, sessionId, client, upstream, calls, emit, input, speak, delegate, control };
}

describe("GPT-Live delegated work continuity", () => {
  it("keeps captured requests FIFO but supplies preceding results when each job executes", async () => {
    const first = deferred<{ sessionId: null; text: string }>();
    let count = 0;
    const f = await fixture(async () => ++count === 1 ? first.promise : { sessionId: null, text: "Already saved." });
    f.input("Add Monday."); f.delegate("a");
    f.speak("On it."); f.input("You are adding Monday, right?"); f.delegate("b");
    f.input("Future unrelated Friday instruction.");
    expect(f.calls).toHaveBeenCalledTimes(1);
    first.resolve({ sessionId: null, text: "Monday saved as cal_monday. Do not create it twice." });
    await tick();
    expect(f.calls).toHaveBeenCalledTimes(2);
    expect(f.calls.mock.calls[1]![1]).toContain("cal_monday");
    expect(f.calls.mock.calls[1]![1]).toContain("reference data only");
    expect(f.calls.mock.calls[1]![1]).toContain("You are adding Monday, right?");
    expect(f.calls.mock.calls[1]![1]).not.toContain("Future unrelated");
    expect(f.calls.mock.calls.every(call => call[0] === f.sessionId)).toBe(true);
    expect(listMessages(f.db, f.sessionId).some(m => m.content.includes("cal_monday"))).toBe(false);
  });

  it("deduplicates exact IDs during execution and after completion; ignores empty delegations", async () => {
    const first = deferred<{ sessionId: null; text: string }>();
    const f = await fixture(async () => first.promise);
    f.input("Save this."); f.delegate("a"); f.delegate("a");
    f.delegate("empty-while-running");
    expect(f.client.frames.filter(e => e.type === "ava.result")).toHaveLength(0);
    expect(f.client.frames.at(-1)).toMatchObject({ type: "error", error: { message: expect.stringContaining("no new user words") } });
    first.resolve({ sessionId: null, text: "Saved." }); await tick();
    f.delegate("a"); f.delegate("b"); await tick();
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.upstream.frames.at(-1)?.content).toContain("no new user words");
    f.input("A new explicit request."); f.delegate("c"); await tick();
    expect(f.calls).toHaveBeenCalledTimes(2);
  });

  it("Stop drops queued jobs and old speech; suppresses late results/steps, but accepts new input", async () => {
    const first = deferred<{ sessionId: null; text: string }>();
    let oldStep: Parameters<LiveRunAction>[2];
    let oldSignal: AbortSignal | undefined;
    let count = 0;
    const f = await fixture(async (_sid, task, step, signal) => {
      if (++count === 1) { oldStep = step; oldSignal = signal; return first.promise; }
      return { sessionId: null, text: "New result." };
    });
    f.input("First."); f.delegate("a"); f.input("Queued second."); f.delegate("b");
    f.input("Unsubmitted old speech."); f.control({ type: "response.cancel" });
    expect(oldSignal?.aborted).toBe(true);
    f.delegate("late-empty");
    f.input("Fresh after Stop."); f.delegate("c");
    oldStep?.("stale_tool", {});
    first.resolve({ sessionId: null, text: "STALE COMPLETION" }); await tick();
    expect(f.calls).toHaveBeenCalledTimes(2);
    const fresh = f.calls.mock.calls[1]![1];
    expect(fresh).toContain('"Fresh after Stop."');
    expect(fresh).toContain("Interrupted before completion");
    expect(fresh).not.toContain("STALE COMPLETION");
    expect(f.client.frames.some(e => e.tool === "stale_tool" || e.text === "STALE COMPLETION")).toBe(false);
  });

  it("close drops queued jobs and ignores subsequent provider events", async () => {
    const first = deferred<{ sessionId: null; text: string }>();
    const f = await fixture(async () => first.promise);
    f.input("First."); f.delegate("a"); f.input("Second."); f.delegate("b");
    f.client.close();
    f.input("Late."); f.delegate("c");
    first.resolve({ sessionId: null, text: "STALE" }); await tick();
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.calls.mock.calls[0]![3]?.aborted).toBe(true);
    expect(f.client.frames.filter(e => e.type === "ava.result")).toEqual([]);
    expect(listMessages(f.db, f.sessionId).map(m => m.content)).not.toContain("Late.");
  });

  it("keeps failures as unverified partial outcomes and lets the queue continue", async () => {
    let count = 0;
    const f = await fixture(async () => {
      if (!count++) throw new Error("Network failure password=hunter2");
      return { sessionId: null, text: "Checked current state." };
    });
    f.input("First."); f.delegate("a"); f.input("What happened?"); f.delegate("b"); await tick();
    expect(f.calls).toHaveBeenCalledTimes(2);
    const next = f.calls.mock.calls[1]![1];
    expect(next).toContain("earlier steps may have taken effect");
    expect(next).not.toContain("hunter2");
    expect(JSON.stringify(f.client.frames)).not.toContain("hunter2");
  });

  it("bounds and sanitises prior result reports without mixing connections", async () => {
    const f = await fixture(async () => ({ sessionId: null,
      text: "Cookie: private-cookie\n-----BEGIN PRIVATE KEY-----\nprivate-pem\n-----END PRIVATE KEY-----\n" + "x".repeat(5000) }));
    for (let i = 0; i < LIVE_RESULT_HISTORY + 2; i++) { f.input(`Request-${i}`); f.delegate(`d${i}`); await tick(); }
    const task = f.calls.mock.calls.at(-1)![1];
    const reports = JSON.parse(task.split("\n\n")[1]!);
    expect(reports).toHaveLength(LIVE_RESULT_HISTORY);
    expect(reports.every((r: { result: string }) => r.result.length <= LIVE_RESULT_CHARS)).toBe(true);
    expect(task).not.toContain("private-cookie"); expect(task).not.toContain("private-pem");
    const other = await fixture(); other.input("Another connection."); other.delegate("d0"); await tick();
    expect(other.calls.mock.calls[0]![1]).not.toContain("Earlier backend result");
  });

  it("caps pending jobs and does not replay a rejected ID", async () => {
    const first = deferred<{ sessionId: null; text: string }>();
    let count = 0;
    const f = await fixture(async () => ++count === 1 ? first.promise : { sessionId: null, text: "Done." });
    for (let i = 0; i <= LIVE_MAX_PENDING_JOBS; i++) { f.input(`Request${i}`); f.delegate(`d${i}`); }
    expect(f.upstream.frames.at(-1)?.content).toContain("not queued");
    expect(f.client.frames.filter(e => e.type === "ava.result")).toHaveLength(0);
    expect(f.client.frames.at(-1)?.type).toBe("error");
    first.resolve({ sessionId: null, text: "Done." }); await tick();
    expect(f.calls).toHaveBeenCalledTimes(LIVE_MAX_PENDING_JOBS);
    f.delegate(`d${LIVE_MAX_PENDING_JOBS}`); await tick();
    expect(f.calls).toHaveBeenCalledTimes(LIVE_MAX_PENDING_JOBS);
  });

  it("never evicts seen IDs to make room, and rejects malformed IDs", async () => {
    const f = await fixture();
    f.input("Request."); f.delegate("bad id");
    expect(f.calls).not.toHaveBeenCalled();
    for (let i = 0; i < LIVE_MAX_DELEGATION_IDS; i++) { f.delegate(`d${i}`); await tick(); }
    f.input("Too late."); f.delegate("new-id"); f.delegate("d0"); await tick();
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.upstream.frames.at(-1)?.content).toContain("action limit");
  });

  it("exact typed input uses the same FIFO, is stored once and does not become spoken history twice", async () => {
    const f = await fixture();
    f.control({ type: "ava.live.text", text: "Exact Name_150 / path?x=1" }); await tick();
    f.delegate("empty-followup"); await tick();
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.calls.mock.calls[0]![1]).toContain("Exact Name_150 / path?x=1");
    expect(listMessages(f.db, f.sessionId)).toMatchObject([{ role: "user", content: "Exact Name_150 / path?x=1" }]);
  });
});

describe("GPT-Live memory updates during a call", () => {
  it("pushes Sir's own memory changes in this conversation at once, and never a forget's content", async () => {
    const db = openInMemoryDb();
    const sessionId = createSession(db, { title: "Synthetic voice test", origin: "human" }).id;
    const archive = new MemoryArchive(db);
    const client = new Socket(), upstream = new Socket();
    const started = startLiveSession({
      client: client as unknown as WebSocket, db,
      binding: { version: 1, sessionId, origin: "human", resolution: "resumed_exact" },
      apiKey: "not-a-real-key", instructions: "Synthetic fixture", memoryArchive: archive,
      hello: () => JSON.stringify({ type: "ava.session", sessionId }),
      connect: () => upstream as unknown as WebSocket,
    });
    upstream.emit("open");
    upstream.emit("message", Buffer.from(JSON.stringify({ type: "session.started" })));
    await started;
    cleanups.push(() => { client.close(); upstream.close(); db.close(); });
    const appended = () => upstream.frames.filter((frame) => frame.type === "session.instructions.append").map((frame) => frame.content as string);
    const base = { kind: "fact" as const, speechAct: "requested" as const, confidence: "high" as const, origin: "explicit" as const, saidAt: Date.now() };
    const mine = archive.add({ ...base, topic: "gym time", text: "Sir trains at 7 pm now." }, "niko", sessionId);
    archive.add({ ...base, topic: "other", text: "From another conversation." }, "niko", "some-other-session");
    archive.add({ ...base, topic: "background", text: "Learned in the background.", origin: "conversation" }, "extractor", sessionId);
    expect(appended()).toEqual([expect.stringContaining("Memory update just now: Sir trains at 7 pm now.")]);
    if (!mine.ok) throw new Error("setup failed");
    archive.forget(mine.record.id, "niko", { sessionId });
    expect(appended()).toHaveLength(2);
    expect(appended()[1]).toContain("asked me to forget something");
    expect(appended()[1]).not.toContain("7 pm");
    client.close();
    await tick();
    archive.add({ ...base, topic: "late", text: "After the call ended." }, "niko", sessionId);
    expect(appended()).toHaveLength(2);
  });
});
