import { describe, it, expect } from "vitest";
import { MessageList } from "./MessageList.js";
describe("MessageList module", () => {
  it("exports a function component", () => {
    expect(typeof MessageList).toBe("function");
  });
});
