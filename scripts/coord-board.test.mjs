import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendBoardEntry,
  BoardAppendError,
  readBoardSnapshot,
} from "./coord-board.mjs";

const roots = [];

async function fixture(content) {
  const root = await mkdtemp(join(tmpdir(), "ava-board-"));
  roots.push(root);
  const boardPath = join(root, "BOARD.md");
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  await writeFile(boardPath, bytes);
  return { boardPath, bytes };
}

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("appends only at physical EOF even when anchors repeat", async () => {
  const base = "# Board\n\nNEEDS: nobody\n\n---\n\nNEEDS: nobody\n";
  const { boardPath, bytes } = await fixture(base);
  const snapshot = await readBoardSnapshot(boardPath);
  await appendBoardEntry({
    boardPath,
    expectedVersion: snapshot.version,
    entry: "---\n\n### CLAIM: exact EOF\n\nRepeated NEEDS text is harmless.\n\nNEEDS: codex",
  });
  const after = await readFile(boardPath);
  assert.deepEqual(after.subarray(0, bytes.length), bytes);
  assert.equal(after.indexOf("### CLAIM: exact EOF"), bytes.length + 6);
  assert.match(after.toString("utf8"), /Repeated NEEDS text is harmless\.\n\nNEEDS: codex\n$/);
});

test("preserves a large board byte-for-byte before the append", async () => {
  const base = Buffer.from(`# Board\n${"duplicate anchor NEEDS: nobody\n".repeat(100_000)}`, "utf8");
  const { boardPath } = await fixture(base);
  const snapshot = await readBoardSnapshot(boardPath);
  const result = await appendBoardEntry({
    boardPath,
    expectedVersion: snapshot.version,
    entry: "---\n\n### Large-file tail\n\nNEEDS: nobody",
  });
  const after = await readFile(boardPath);
  assert.deepEqual(after.subarray(0, base.length), base);
  assert.equal(result.previousByteLength, base.length);
  assert.equal(result.byteLength, after.length);
});

test("preserves UTF-8 and the board's CRLF convention without changing prior bytes", async () => {
  const base = Buffer.from("# AVA Board\r\n\r\nSæll Niko — ძველი ტექსტი\r\n", "utf8");
  const { boardPath } = await fixture(base);
  const snapshot = await readBoardSnapshot(boardPath);
  await appendBoardEntry({
    boardPath,
    expectedVersion: snapshot.version,
    entry: "---\n\n### UTF-8 ✓\n\nClaude, Codex, and AVA — chronology.\n\nNEEDS: niko",
  });
  const after = await readFile(boardPath);
  assert.deepEqual(after.subarray(0, base.length), base);
  const added = after.subarray(base.length).toString("utf8");
  assert.match(added, /^\r\n---\r\n\r\n### UTF-8 ✓/);
  assert.equal(/(^|[^\r])\n/.test(added), false);
  assert.match(added, /NEEDS: niko\r\n$/);
});

test("rejects a stale expected version and leaves every byte unchanged", async () => {
  const { boardPath } = await fixture("# Board\n");
  const stale = await readBoardSnapshot(boardPath);
  await writeFile(boardPath, "# Board\n\nother writer\n", "utf8");
  const before = await readFile(boardPath);
  await assert.rejects(
    appendBoardEntry({
      boardPath,
      expectedVersion: stale.version,
      entry: "---\n\n### Stale\n\nNEEDS: codex",
    }),
    (error) => error instanceof BoardAppendError
      && error.code === "STALE_BOARD"
      && error.message.includes("re-read the physical tail"),
  );
  assert.deepEqual(await readFile(boardPath), before);
});

test("rejects entries whose NEEDS handoff is not the final line", async () => {
  const { boardPath } = await fixture("# Board\n");
  const snapshot = await readBoardSnapshot(boardPath);
  await assert.rejects(
    appendBoardEntry({
      boardPath,
      expectedVersion: snapshot.version,
      entry: "---\n\n### Incomplete\n\nNEEDS: codex\n\ntext after handoff",
    }),
    (error) => error instanceof BoardAppendError && error.code === "INVALID_ENTRY",
  );
  assert.equal(await readFile(boardPath, "utf8"), "# Board\n");
});

test("serializes simultaneous writers so one appends and one fails stale without clobbering", async () => {
  const base = Buffer.from("# Board\n", "utf8");
  const { boardPath } = await fixture(base);
  const snapshot = await readBoardSnapshot(boardPath);
  const entries = ["Writer A", "Writer B"].map((name) => appendBoardEntry({
    boardPath,
    expectedVersion: snapshot.version,
    entry: `---\n\n### ${name}\n\nNEEDS: nobody`,
    retryMs: 2,
  }));
  const results = await Promise.allSettled(entries);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "STALE_BOARD");
  const after = await readFile(boardPath);
  assert.deepEqual(after.subarray(0, base.length), base);
  assert.equal((after.toString("utf8").match(/### Writer [AB]/g) ?? []).length, 1);
  assert.match(after.toString("utf8"), /NEEDS: nobody\n$/);
});

test("reports a bounded lock timeout instead of bypassing a live writer", async () => {
  const { boardPath } = await fixture("# Board\n");
  const lockPath = join(join(boardPath, ".."), ".BOARD.md.append.lock");
  await writeFile(lockPath, JSON.stringify({ token: "live", pid: process.pid, host: (await import("node:os")).hostname() }));
  const snapshot = await readBoardSnapshot(boardPath);
  await assert.rejects(
    appendBoardEntry({
      boardPath,
      expectedVersion: snapshot.version,
      entry: "---\n\n### Busy\n\nNEEDS: codex",
      lockTimeoutMs: 25,
      retryMs: 2,
      lockStaleMs: 1,
    }),
    (error) => error instanceof BoardAppendError
      && error.code === "LOCK_TIMEOUT"
      && error.message.includes("busy"),
  );
});

test("places CLAIM then COMPLETE at successive physical tails without corrective markers", async () => {
  const { boardPath } = await fixture("# Board\n");
  const first = await readBoardSnapshot(boardPath);
  await appendBoardEntry({
    boardPath,
    expectedVersion: first.version,
    entry: "---\n\n### CLAIM: bounded work\n\nNEEDS: codex",
  });
  const second = await readBoardSnapshot(boardPath);
  await appendBoardEntry({
    boardPath,
    expectedVersion: second.version,
    entry: "---\n\n### COMPLETE: bounded work\n\nNEEDS: nobody",
  });
  const after = await readFile(boardPath, "utf8");
  assert.ok(after.indexOf("### CLAIM") < after.indexOf("### COMPLETE"));
  assert.match(after, /### COMPLETE: bounded work\n\nNEEDS: nobody\n$/);
  assert.equal(after.includes("PHYSICAL-TAIL"), false);
});

test("recovers an old malformed lock but never a current live lock", async () => {
  const { boardPath } = await fixture("# Board\n");
  const lockPath = join(join(boardPath, ".."), ".BOARD.md.append.lock");
  await writeFile(lockPath, "abandoned");
  const old = new Date(Date.now() - 60_000);
  await utimes(lockPath, old, old);
  const snapshot = await readBoardSnapshot(boardPath);
  await appendBoardEntry({
    boardPath,
    expectedVersion: snapshot.version,
    entry: "---\n\n### Recovered\n\nNEEDS: nobody",
    lockStaleMs: 5,
    retryMs: 2,
  });
  assert.match(await readFile(boardPath, "utf8"), /### Recovered/);
});
