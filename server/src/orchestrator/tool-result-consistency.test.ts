import { describe, it, expect } from "vitest";
import {
  classifyActionResult,
  worstClass,
  buildConsistencyReminder,
  CONSISTENCY_REMINDER_MARKER,
} from "./tool-result-consistency.js";

const ok = (output: string, is_error = false) => classifyActionResult({ output, is_error });

describe("classifyActionResult — failures", () => {
  it("flags transport is_error", () => {
    expect(classifyActionResult({ output: "anything", is_error: true })).toBe("error");
  });

  it("flags ok:false", () => {
    expect(ok(JSON.stringify({ ok: false, text: "nope" }))).toBe("error");
  });

  it("flags success:false", () => {
    expect(ok(JSON.stringify({ success: false }))).toBe("error");
  });

  it("flags a nonzero exit code", () => {
    expect(ok(JSON.stringify({ exitCode: 1, stdout: "" }))).toBe("error");
    expect(ok(JSON.stringify({ exit_code: 127 }))).toBe("error");
    expect(ok(JSON.stringify({ code: 2 }))).toBe("error");
  });

  it("flags a truthy error field", () => {
    expect(ok(JSON.stringify({ error: "ENOENT: no such file" }))).toBe("error");
    expect(ok(JSON.stringify({ error: { message: "boom" } }))).toBe("error");
  });

  it("flags status: failed", () => {
    expect(ok(JSON.stringify({ status: "failed" }))).toBe("error");
    expect(ok(JSON.stringify({ status: "ERROR" }))).toBe("error");
  });
});

describe("classifyActionResult — partial/uncertain", () => {
  it("flags status: partial", () => {
    expect(ok(JSON.stringify({ status: "partial", done: 3, total: 10 }))).toBe("uncertain");
  });

  it("flags status: uncertain", () => {
    expect(ok(JSON.stringify({ status: "uncertain" }))).toBe("uncertain");
  });

  it("flags status: incomplete", () => {
    expect(ok(JSON.stringify({ status: "incomplete" }))).toBe("uncertain");
  });
});

describe("classifyActionResult — clean success", () => {
  it("treats ok:true as ok", () => {
    expect(ok(JSON.stringify({ ok: true, text: "file1\nfile2" }))).toBe("ok");
  });

  it("treats exitCode 0 as ok", () => {
    expect(ok(JSON.stringify({ exitCode: 0, stdout: "done" }))).toBe("ok");
  });

  it("treats status: success / completed as ok", () => {
    expect(ok(JSON.stringify({ status: "success" }))).toBe("ok");
    expect(ok(JSON.stringify({ status: "completed" }))).toBe("ok");
  });

  it("treats null error field as ok", () => {
    expect(ok(JSON.stringify({ ok: true, error: null }))).toBe("ok");
  });

  it("treats plain non-JSON text as ok", () => {
    expect(ok("file1\nfile2\n")).toBe("ok");
  });

  it("treats empty/garbage as ok", () => {
    expect(ok("")).toBe("ok");
    expect(ok("not json {")).toBe("ok");
  });
});

describe("worstClass", () => {
  it("error dominates", () => {
    expect(worstClass(["ok", "uncertain", "error"])).toBe("error");
  });
  it("uncertain beats ok", () => {
    expect(worstClass(["ok", "uncertain", "ok"])).toBe("uncertain");
  });
  it("all ok stays ok", () => {
    expect(worstClass(["ok", "ok"])).toBe("ok");
    expect(worstClass([])).toBe("ok");
  });
});

describe("buildConsistencyReminder", () => {
  it("error reminder forbids success phrasing and is marked", () => {
    const msg = buildConsistencyReminder("error");
    expect(msg).toContain(CONSISTENCY_REMINDER_MARKER);
    expect(msg.toLowerCase()).toContain("failure");
    expect(msg.toLowerCase()).toContain("do not claim");
  });

  it("uncertain reminder mentions partial/incomplete", () => {
    const msg = buildConsistencyReminder("uncertain");
    expect(msg).toContain(CONSISTENCY_REMINDER_MARKER);
    expect(msg.toLowerCase()).toContain("partial");
    expect(msg.toLowerCase()).toContain("do not claim");
  });
});
