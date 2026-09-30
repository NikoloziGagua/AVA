import { describe, it, expect } from "vitest";
import { Button } from "./button.js";
import { Textarea } from "./textarea.js";
import { Badge } from "./badge.js";
import { Dialog, DialogContent, DialogTrigger } from "./dialog.js";

describe("shadcn ui primitives", () => {
  it("export expected components", () => {
    expect(typeof Button).toBe("object"); // forwardRef -> object
    expect(typeof Textarea).toBe("object");
    expect(typeof Badge).toBe("function");
    expect(typeof Dialog).toBe("function");
    expect(typeof DialogContent).toBe("object");
    expect(typeof DialogTrigger).toBe("object");
  });
});
