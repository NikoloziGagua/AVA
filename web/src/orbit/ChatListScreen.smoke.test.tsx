import { describe, it, expect } from "vitest";
import { ChatListScreen } from "./ChatListScreen.js";
describe("ChatListScreen module", () => {
  it("exports a function component", () => {
    expect(typeof ChatListScreen).toBe("function");
  });
});
