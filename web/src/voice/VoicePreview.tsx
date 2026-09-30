import { useEffect, useMemo, useState } from "react";
import { claimFaceSignalWriter, type FaceSignalMode } from "./faceSignal.js";
import { VoiceScreenBody } from "./VoiceScreen.js";
import type { useRealtimeVoice } from "./useRealtimeVoice.js";

type Scene = "listening" | "thinking" | "speaking" | "working" | "approval" | "hold";

const SCENES: Array<{ id: Scene; label: string }> = [
  { id: "listening", label: "Listening" },
  { id: "thinking", label: "Thinking" },
  { id: "speaking", label: "Speaking" },
  { id: "working", label: "Working" },
  { id: "approval", label: "Approval" },
  { id: "hold", label: "Hold to talk" },
];

const SIGNAL: Record<Scene, FaceSignalMode> = {
  listening: "listening", thinking: "thinking", speaking: "speaking", working: "thinking", approval: "thinking", hold: "idle",
};

/**
 * The real Voice screen with a stand-in voice hook, for the design gallery
 * (?design-gallery=voice). It never opens the microphone or a connection;
 * the buttons at the top switch between the states Niko will see.
 */
export function VoicePreview() {
  const [scene, setScene] = useState<Scene>("listening");

  // Drive the shared face signal the way the engines do. The level is left to
  // the face's own rhythm: this preview has no real voice to measure.
  useEffect(() => {
    const writer = claimFaceSignalWriter("gallery");
    writer.setMode(SIGNAL[scene]);
    writer.setOutputSource(scene === "speaking" ? "synthetic" : "none");
    return () => writer.release();
  }, [scene]);

  const v = useMemo(() => {
    const noop = () => {};
    const now = Date.now();
    return {
      state: scene === "speaking" ? "responding" : scene === "thinking" || scene === "working" || scene === "approval" ? "thinking" : "listening",
      sessionId: "preview",
      getSessionId: () => "preview",
      unavailable: false,
      caption: null,
      turns: [],
      interim: scene === "speaking"
        ? { who: "ava", text: "You have Agile at ten and a reminder for the mock paper at six." }
        : scene === "listening"
          ? { who: "you", text: "What's on today?" }
          : null,
      amplitude: 0,
      hint: null,
      clearHint: noop,
      errorMsg: null,
      clearError: noop,
      muted: false,
      setMuted: noop,
      pendingApproval: scene === "approval"
        ? { id: "preview", tool: "send_email", summary: "Send the extension request to your tutor", riskTier: "medium", timeoutBehavior: "auto_approve", requestedAt: now, deadlineAt: now + 15_000, timeoutMs: 15_000 }
        : null,
      actionPending: scene === "working",
      approve: noop,
      deny: noop,
      start: noop,
      stop: noop,
      interrupt: noop,
      submitExactText: async () => true,
      newConversation: noop,
      inputMode: scene === "hold" ? "enter_push_to_talk" : "vad",
      setInputMode: noop,
      capturing: false,
      startPtt: noop,
      finishPtt: noop,
      togglePushToTalk: noop,
      voiceEngine: "openai",
      setVoiceEngine: noop,
    } as unknown as ReturnType<typeof useRealtimeVoice>;
  }, [scene]);

  return (
    <div className="fixed inset-0">
      <VoiceScreenBody initialSessionId="preview" onExit={() => { window.location.search = "?design-gallery"; }} onSwitchToKeyboard={() => {}} v={v} />
      <label className="ds-root fixed left-3 z-50 flex items-center gap-2 rounded-full bg-raised py-1 pl-3 pr-1 font-ui text-meta text-ink-2 shadow-e2" style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
        Preview
        <select
          aria-label="Preview state"
          value={scene}
          onChange={(event) => setScene(event.target.value as Scene)}
          className="ds-focus h-9 rounded-full bg-glass px-3 text-meta text-ink"
        >
          {SCENES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
    </div>
  );
}
