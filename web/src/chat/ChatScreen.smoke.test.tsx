import { describe, it, expect } from "vitest";
import { ChatScreen } from "./ChatScreen.js";
describe("ChatScreen module", () => {
  it("exports a function component", () => {
    expect(typeof ChatScreen).toBe("function");
  });
});
