import { describe, it, expect, vi } from "vitest";
import { runComputerUse, type ComputerSurface } from "./computer-use.js";

function makeSurface(): ComputerSurface & {
  mouseClick: ReturnType<typeof vi.fn>;
  mouseWheel: ReturnType<typeof vi.fn>;
  keyboardType: ReturnType<typeof vi.fn>;
  keyboardPress: ReturnType<typeof vi.fn>;
  screenshotBytes: ReturnType<typeof vi.fn>;
  viewport: ReturnType<typeof vi.fn>;
} {
  return {
    mouseClick: vi.fn().mockResolvedValue({ ok: true }),
    mouseWheel: vi.fn().mockResolvedValue({ ok: true }),
    keyboardType: vi.fn().mockResolvedValue({ ok: true }),
    keyboardPress: vi.fn().mockResolvedValue({ ok: true }),
    screenshotBytes: vi
      .fn()
      .mockResolvedValue({ ok: true, base64: "YWJj", path: "/tmp/x.png" }),
    viewport: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
  };
}

function makeClient() {
  const create = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { beta: { messages: { create } } } as any;
  return { client, create };
}

describe("runComputerUse", () => {
  it("returns summary on single end_turn response", async () => {
    const surface = makeSurface();
    const { client, create } = makeClient();
    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "All done." }],
    });

    const r = await runComputerUse({ client, surface }, { task: "do something" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary).toBe("All done.");
      expect(r.screenshots.length).toBe(1);
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("executes a click action then ends", async () => {
    const surface = makeSurface();
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "computer",
            input: { action: "left_click", coordinate: [100, 200] },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Clicked." }],
      });

    const r = await runComputerUse({ client, surface }, { task: "click the button" });
    expect(r.ok).toBe(true);
    expect(surface.mouseClick).toHaveBeenCalledWith(100, 200);
    if (r.ok) {
      expect(r.screenshots.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("executes a type action", async () => {
    const surface = makeSurface();
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "computer",
            input: { action: "type", text: "hello world" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Typed." }],
      });

    const r = await runComputerUse({ client, surface }, { task: "type stuff" });
    expect(r.ok).toBe(true);
    expect(surface.keyboardType).toHaveBeenCalledWith("hello world");
  });

  it("returns error on unsupported action", async () => {
    const surface = makeSurface();
    const { client, create } = makeClient();
    create.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "toolu_3",
          name: "computer",
          input: { action: "double_click", coordinate: [10, 20] },
        },
      ],
    });

    const r = await runComputerUse({ client, surface }, { task: "do" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/unsupported action/);
    }
  });

  it("returns error on empty task", async () => {
    const surface = makeSurface();
    const { client } = makeClient();
    const r = await runComputerUse({ client, surface }, { task: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("task required");
  });

  it("bails immediately when given an already-aborted signal (Stop reaches the GUI loop)", async () => {
    const surface = makeSurface();
    const { client, create } = makeClient();
    const ac = new AbortController();
    ac.abort();
    const r = await runComputerUse(
      { client, surface, signal: ac.signal },
      { task: "do something" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("interrupted");
    // Never calls the model when already aborted, and never even screenshots.
    expect(create).not.toHaveBeenCalled();
    expect(surface.screenshotBytes).not.toHaveBeenCalled();
  });
});
