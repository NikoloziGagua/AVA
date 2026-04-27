// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getToken, setToken, clearToken } from "./tokens.js";

describe("token storage", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when nothing is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("round-trips set/get", () => {
    setToken("abc123");
    expect(getToken()).toBe("abc123");
  });

  it("clear removes the value", () => {
    setToken("abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
