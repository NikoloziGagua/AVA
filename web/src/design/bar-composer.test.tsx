import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BottomBar, type BarConversation } from "./index.js";
import type { Transcribe } from "./dictation.js";

/** The bar as Talk uses it: the message box of one conversation. */
function Talk({ conversation, dictate, initial = "", focusRequest = 0 }: {
  conversation?: Partial<BarConversation>;
  dictate?: Transcribe;
  initial?: string;
  focusRequest?: number;
}) {
  const [draft, setDraft] = useState(initial);
  const talk = { onSend: vi.fn(), busy: false, onStop: vi.fn(), onVoice: vi.fn(), ...conversation };
  return (
    <BottomBar
      destinations={[]}
      current="talk"
      onNavigate={() => {}}
      draft={draft}
      onDraftChange={setDraft}
      onSend={(text) => { talk.onSend(text); setDraft(""); }}
      onTalk={talk.onVoice}
      busy={talk.busy}
      onStop={talk.onStop}
      dictate={dictate}
      focusRequest={focusRequest}
    />
  );
}

const box = () => screen.getByRole("textbox", { name: "Message AVA" }) as HTMLTextAreaElement;

class FakeRecorder {
  static isTypeSupported = () => true;
  static last: FakeRecorder | null = null;
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { FakeRecorder.last = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); track.stop.mockClear(); FakeRecorder.last = null; });

describe("BottomBar as Talk's message box", () => {
  it("sends on Enter, starts a new line on Shift+Enter, and never mid-word in an input method", () => {
    const onSend = vi.fn();
    render(<Talk conversation={{ onSend }} />);
    fireEvent.change(box(), { target: { value: "first line" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("first line");
  });

  it("turns Send into Stop while AVA replies and refuses to send until she is done", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Talk conversation={{ onSend, onStop, busy: true }} initial="next question" />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop AVA" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Talk to AVA" })).toBeTruthy();
  });

  it("puts the cursor in the box when asked", () => {
    const { rerender } = render(<Talk focusRequest={0} />);
    expect(document.activeElement).not.toBe(box());
    rerender(<Talk focusRequest={1} />);
    expect(document.activeElement).toBe(box());
  });

  it("offers dictation only when the screen provides it", () => {
    const { rerender } = render(<Talk />);
    expect(screen.queryByRole("button", { name: "Dictate message" })).toBeNull();
    rerender(<Talk dictate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Dictate message" })).toBeTruthy();
  });

  it("dictates into the existing draft and never sends by itself", async () => {
    const onSend = vi.fn();
    const dictate = vi.fn<Transcribe>(async () => "and bring the notes");
    render(<Talk conversation={{ onSend }} dictate={dictate} initial="Remind me about the exam" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    await screen.findByRole("button", { name: "Stop dictation" });
    expect(screen.getByRole("status").textContent).toMatch(/nothing sends by itself/);
    fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
    await waitFor(() => expect(box().value).toBe("Remind me about the exam and bring the notes"));
    expect(dictate).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("says why dictation failed, in words", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); }) },
    });
    render(<Talk dictate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/permission was denied/);
    expect(screen.getByRole("button", { name: "Retry dictation" })).toBeTruthy();
  });

  it("stops recording and uploads nothing when the screen that offered dictation goes away", async () => {
    const dictate = vi.fn<Transcribe>(async () => "never");
    const { rerender } = render(<Talk dictate={dictate} initial="kept" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    await screen.findByRole("button", { name: "Stop dictation" });
    rerender(<Talk initial="kept" />);
    await act(async () => {});
    expect(FakeRecorder.last?.state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
    expect(dictate).not.toHaveBeenCalled();
    expect(box().value).toBe("kept");
  });

  it("tells screens how much room it takes, so nothing hides behind it", () => {
    render(<Talk />);
    expect(document.documentElement.style.getPropertyValue("--ds-bar-space")).toMatch(/px$/);
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--ds-bar-space")).toBe("");
  });
});
