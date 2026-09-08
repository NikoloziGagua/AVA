// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const transcribe = vi.fn<() => Promise<string>>();

vi.mock("../api.js", () => ({
  fetchSuggestedChips: vi.fn(async () => []),
  transcribeAudio: (...args: unknown[]) => transcribe(...args as []),
}));

import {
  Composer,
  describeDictationError,
  insertDictation,
  normalizedAudioMime,
} from "./Composer.js";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => type.startsWith("audio/webm"));
  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start(): void { this.state = "recording"; }
  stop(): void {
    if (this.state !== "recording") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded"], { type: "audio/webm" }) } as BlobEvent);
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));

beforeEach(() => {
  transcribe.mockReset();
  transcribe.mockResolvedValue("blue lantern");
  stopTrack.mockReset();
  getUserMedia.mockClear();
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const props = {
    onSend: vi.fn(),
    onKill: vi.fn(),
    onMicTap: vi.fn(),
    busy: false,
    seed: { text: "", version: 0 },
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe("chat composer dictation", () => {
  it("records, transcribes into the existing editable draft, and never auto-sends", async () => {
    const props = renderComposer();
    const input = screen.getByPlaceholderText("Message Ava…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Existing draft" } });

    fireEvent.click(screen.getByRole("button", { name: "dictate message" }));
    await screen.findByRole("button", { name: "stop dictation" });
    expect(screen.getByText(/Nothing will send automatically/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "stop dictation" }));
    await waitFor(() => expect(input.value).toBe("Existing draft blue lantern"));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(props.onSend).not.toHaveBeenCalled();
    expect(props.onMicTap).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("cancels cleanly without uploading or changing the draft", async () => {
    renderComposer({ seed: { text: "Keep this", version: 1 } });
    const input = screen.getByPlaceholderText("Message Ava…") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "dictate message" }));
    await screen.findByRole("button", { name: "cancel dictation" });
    fireEvent.click(screen.getByRole("button", { name: "cancel dictation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "dictate message" })).toBeTruthy());
    expect(input.value).toBe("Keep this");
    expect(transcribe).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("keeps full Voice Mode as a separate explicit control", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    expect(props.onMicTap).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("dictation helpers", () => {
  it("preserves whitespace and normalizes codec-bearing browser MIME types", () => {
    expect(insertDictation("Draft", " spoken text ")).toBe("Draft spoken text");
    expect(insertDictation("Draft ", "spoken text")).toBe("Draft spoken text");
    expect(normalizedAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("turns permission failures into actionable copy", () => {
    expect(describeDictationError(Object.assign(new Error("denied"), { name: "NotAllowedError" })))
      .toContain("permission was denied");
  });
});
