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
  it("expands on focus or draft, never remounts the textarea, and keeps Voice's draft visible as a hint", () => {
    const props = { destinations: [], current: "home", onNavigate: vi.fn(), draft: "", onDraftChange: vi.fn(), onSend: vi.fn() };
    const { rerender } = render(<BottomBar {...props} />);
    const input = box();
    const form = input.closest("form")!;
    expect(form.dataset.expanded).toBe("false");
    fireEvent.focus(input);
    expect(form.dataset.expanded).toBe("true");
    fireEvent.blur(input, { relatedTarget: null });
    expect(form.dataset.expanded).toBe("false");
    rerender(<BottomBar {...props} draft="not sent" />);
    expect(box()).toBe(input);
    expect(form.dataset.expanded).toBe("true");
    rerender(<BottomBar {...props} draft="not sent" compact />);
    expect(screen.getByText("Draft kept")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("textarea")).toBe(input);
    rerender(<BottomBar {...props} current="talk" />);
    expect(box()).toBe(input);
    expect(form.dataset.expanded).toBe("true");
    rerender(<BottomBar {...props} busy onStop={vi.fn()} />);
    expect(form.dataset.expanded).toBe("true");
    expect(screen.getByRole("button", { name: "Stop AVA" })).toBeTruthy();
    expect(props.onSend).not.toHaveBeenCalled();
  });
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

  it("draws its keyboard focus ring rounded, matching the pill", () => {
    render(<Talk />);
    expect(box().className).toMatch(/\brounded-button\b/);
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

  it("never lets a cancelled transcription touch the next recording", async () => {
    let answerFirst!: (text: string) => void;
    let failFirst!: (error: Error) => void;
    const dictate = vi.fn<Transcribe>()
      .mockImplementationOnce(() => new Promise<string>((resolve, reject) => { answerFirst = resolve; failFirst = reject; }))
      .mockImplementationOnce(async () => "second take");
    render(<Talk dictate={dictate} initial="kept" />);

    // Clip A: record, stop, and cancel while it is being transcribed.
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop dictation" }));
    await waitFor(() => expect(dictate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" }));

    // Clip B straight away.
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop dictation" }));
    await waitFor(() => expect(box().value).toBe("kept second take"));

    // A answers late, then fails late: neither reaches the draft or the status.
    await act(async () => { answerFirst("stale words"); });
    await act(async () => { failFirst(new Error("late failure")); });
    expect(box().value).toBe("kept second take");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Dictate message" })).toBeTruthy();
  });

  it("transcribes nothing after the recorder reports an error", async () => {
    const dictate = vi.fn<Transcribe>(async () => "never");
    render(<Talk dictate={dictate} initial="kept" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictate message" }));
    await screen.findByRole("button", { name: "Stop dictation" });
    const recorder = FakeRecorder.last!;
    act(() => { recorder.onerror?.(); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not record/);
    act(() => { recorder.stop(); });
    await act(async () => {});
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
