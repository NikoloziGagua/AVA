import { describe, it, expect } from "vitest";
import { resolveActiveIndex } from "./tubelight-nav.js";

const items = [{ name: "New" }, { name: "Chats" }, { name: "Memory" }];

describe("resolveActiveIndex", () => {
  it("returns -1 for no items", () => {
    expect(resolveActiveIndex([], "New")).toBe(-1);
  });
  it("defaults to the first item when there's no match", () => {
    expect(resolveActiveIndex(items)).toBe(0);
    expect(resolveActiveIndex(items, "Nope")).toBe(0);
  });
  it("finds the matching item", () => {
    expect(resolveActiveIndex(items, "Memory")).toBe(2);
  });
});
