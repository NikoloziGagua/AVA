import { describe, expect, it } from "vitest";
import { redactSensitiveArgs } from "./redact.js";

// Unit tests for the central tool-arg redaction. The contract: any emitted
// args (SSE, approvals, playbook capture, logs) must never carry credentials.

describe("redactSensitiveArgs", () => {
  it("masks the classic credential keys to ***", () => {
    const out = redactSensitiveArgs({
      password: "hunter2",
      passcode: "123456",
      token: "tok_live_abcdef",
      access_token: "at-1",
      otp: "000111",
      secret: "shh",
      api_key: "k1",
      apiKey: "k2",
      credentials: "user:pass",
      pin: "4321",
    });
    expect(out).toEqual({
      password: "***",
      passcode: "***",
      token: "***",
      access_token: "***",
      otp: "***",
      secret: "***",
      api_key: "***",
      apiKey: "***",
      credentials: "***",
      pin: "***",
    });
  });

  it("matches key names case-insensitively", () => {
    expect(redactSensitiveArgs({ PASSWORD: "x", Token: "y" })).toEqual({
      PASSWORD: "***",
      Token: "***",
    });
  });

  it("masks a bare 'code' key (the 2FA code arg of instagram_submit_code)", () => {
    expect(redactSensitiveArgs({ code: "123456" })).toEqual({ code: "***" });
  });

  it("recurses into nested objects", () => {
    const out = redactSensitiveArgs({
      instagram: { login: { username: "nika_gagua", password: "hunter2" } },
      depth: { a: { b: { c: { token: "deep" } } } },
    });
    expect(out).toEqual({
      instagram: { login: { username: "nika_gagua", password: "***" } },
      depth: { a: { b: { c: { token: "***" } } } },
    });
  });

  it("recurses into arrays, leaving primitive elements alone", () => {
    expect(redactSensitiveArgs([{ token: "t" }, "plain", 7, null])).toEqual([
      { token: "***" },
      "plain",
      7,
      null,
    ]);
    expect(redactSensitiveArgs({ accounts: [{ password: "a" }, { name: "b" }] })).toEqual({
      accounts: [{ password: "***" }, { name: "b" }],
    });
  });

  it("leaves non-sensitive keys untouched even when values look secret", () => {
    const args = {
      username: "nika_gagua",
      message: "the password is hunter2",
      url: "https://example.com/?q=1",
      count: 3,
      enabled: true,
    };
    expect(redactSensitiveArgs(args)).toEqual(args);
  });

  it("passes non-object inputs through unchanged", () => {
    expect(redactSensitiveArgs(null)).toBeNull();
    expect(redactSensitiveArgs(undefined)).toBeUndefined();
    expect(redactSensitiveArgs("password=hunter2")).toBe("password=hunter2");
    expect(redactSensitiveArgs(42)).toBe(42);
    expect(redactSensitiveArgs(true)).toBe(true);
  });

  it("leaves an empty-string password untouched", () => {
    expect(redactSensitiveArgs({ password: "" })).toEqual({ password: "" });
  });

  it("masks sensitive NUMBERS too ({passcode: 123456} is as hot as a string), leaves null alone", () => {
    expect(redactSensitiveArgs({ token: 12345, otp: null })).toEqual({ token: "***", otp: null });
    // An object under a sensitive key is recursed, not wholesale-masked.
    expect(redactSensitiveArgs({ credentials: { password: "x", host: "db" } })).toEqual({
      credentials: { password: "***", host: "db" },
    });
  });

  it("scrubs sensitive fields inside string blobs (the _raw malformed-args sentinel)", () => {
    const blob = '{"username":"nika","password":"hunter2","note":"hi"}';
    const out = redactSensitiveArgs({ _raw: blob });
    expect((out as { _raw: string })._raw).toContain('"password":"***"');
    expect((out as { _raw: string })._raw).toContain('"username":"nika"');
  });

  it("returns a new object and never mutates its input", () => {
    const input = { password: "hunter2", nested: { token: "t", list: [{ secret: "s" }] } };
    const copy = structuredClone(input);
    const out = redactSensitiveArgs(input);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
    expect(out.nested).not.toBe(input.nested);
  });
});
