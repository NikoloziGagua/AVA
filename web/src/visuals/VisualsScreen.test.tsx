// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchAll: vi.fn(), fetchOne: vi.fn(), cached: vi.fn() }));
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, fetchVisualExplanations: mocks.fetchAll, fetchVisualExplanation: mocks.fetchOne, readCachedVisuals: mocks.cached };
});
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
}));
vi.mock("./VisualExplanationViewer.js", () => ({ VisualExplanationViewer: ({ visual }: any) => <div>viewer-{visual.id}</div> }));

import { ApiError } from "../api.js";
import { visualFixture } from "./fixtures.test-helper.js";
import { VisualsScreen } from "./VisualsScreen.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("VisualsScreen", () => {
  it("loads the requested explanation and starts generation through AVA chat", async () => {
    mocks.cached.mockReturnValue([]);
    mocks.fetchAll.mockResolvedValue([visualFixture]);
    const onCreate = vi.fn();
    render(<VisualsScreen initialVisualId={visualFixture.id} onCreate={onCreate} />);
    expect(await screen.findByText(`viewer-${visualFixture.id}`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What should AVA explain visually?"), { target: { value: "the AVA request path" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AVA to build it" }));
    expect(onCreate).toHaveBeenCalledWith(expect.stringContaining("the AVA request path"));
    expect(onCreate).toHaveBeenCalledWith(expect.stringContaining("stable Mermaid IDs"));
  });

  it("keeps cached explanations usable when AVA is offline", async () => {
    mocks.cached.mockReturnValue([visualFixture]);
    mocks.fetchAll.mockRejectedValue(new ApiError(0, "offline"));
    render(<VisualsScreen onCreate={() => {}} />);
    expect(await screen.findByText("Offline — cached visuals")).toBeTruthy();
    expect(screen.getByText(`viewer-${visualFixture.id}`)).toBeTruthy();
  });
});

