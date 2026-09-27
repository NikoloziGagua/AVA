import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../design/face/FaceStage.js", () => ({ FaceStage: () => <div data-testid="face" /> }));
vi.mock("../design/face/FaceStill.js", () => ({ FaceStill: () => null }));

import { HomeScreen } from "./HomeScreen.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("HomeScreen", () => {
  it("shows only the face, the island and a greeting", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<HomeScreen />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (night|morning|afternoon|evening), Niko\.$/);
    expect(document.querySelector(".ds-island")?.textContent).toContain("AVA");
    expect(screen.queryByText(/one thing for today/i)).toBeNull();
    expect(screen.queryByText("A few starting points")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
