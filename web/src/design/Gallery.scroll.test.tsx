import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./face/FaceStage.js", () => ({ FaceStage: () => <div>Face preview</div> }));
vi.mock("../chat/TalkGallery.js", () => ({ TalkGallery: () => <div>Talk preview</div> }));
vi.mock("../voice/VoicePreview.js", () => ({ VoicePreview: () => <div>Voice preview</div> }));

import { DesignGallery } from "./Gallery.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("DesignGallery scrolling", () => {
  it("owns a full-height vertical scroller beneath the fixed SPA root", () => {
    window.history.replaceState({}, "", "/?design-gallery");
    render(<DesignGallery />);

    const scroller = screen.getByTestId("design-gallery-scroll");
    expect(scroller.className).toContain("h-full");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.textContent).toContain("Ink and Paper");
  });
});
