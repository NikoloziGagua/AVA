import { describe, it, expect } from "vitest";
import { Alert, AlertTitle, AlertDescription, AlertIcon, AlertContent } from "./alert.js";

describe("alert kit", () => {
  it("exports the expected components", () => {
    expect(typeof Alert).toBe("function");
    expect(typeof AlertTitle).toBe("function");
    expect(typeof AlertDescription).toBe("function");
    expect(typeof AlertIcon).toBe("function");
    expect(typeof AlertContent).toBe("function");
  });
});
