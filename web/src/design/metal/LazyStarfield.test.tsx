import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.doUnmock("./Starfield.js"); });

it("loads decoration only on mount; a rejected chunk never removes content", async () => {
  vi.resetModules();
  const load = vi.fn(() => { throw new Error("offline chunk unavailable"); });
  vi.doMock("./Starfield.js", load);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { LazyStarfield } = await import("./LazyStarfield.js");
  expect(load).not.toHaveBeenCalled();
  render(<><LazyStarfield /><button>Keep talking</button></>);
  await act(async () => { await Promise.resolve(); });
  expect(load).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Keep talking" })).toBeTruthy();
  expect(document.querySelector("canvas")).toBeNull();
});
