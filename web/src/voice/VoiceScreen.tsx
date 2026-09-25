import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard, MessageSquarePlus, Mic, MicOff, PanelsTopLeft, Square, Type, X } from "lucide-react";
import { useRealtimeVoice, type RealtimeState } from "./useRealtimeVoice.js";
import { VoiceExactTextDialog } from "./VoiceExactTextDialog.js";
import { HoldToTalkButton } from "./HoldToTalkButton.js";
import { useLiveVoice } from "./useLiveVoice.js";
import { getFaceSignalMode, sampleFaceSignalLevels, subscribeFaceSignalMode } from "./faceSignal.js";
import { fetchVoiceEngine, type VoiceEngine } from "../api.js";
import type { ConversationIntent } from "../api.js";
import { Button } from "../design/Button.js";
import { StatusIsland, type IslandMode } from "../design/StatusIsland.js";
import { cn } from "../design/cn.js";
import { LazyFace } from "../design/face/LazyFace.js";
import { FaceStill } from "../design/face/FaceStill.js";
import {
  approvalRiskLabel,
  approvalTimeoutLabel,
  pendingApprovalCopy,
  useApprovalTiming,
} from "../approvals/presentation.js";

export interface VoiceScreenProps {
  initialSessionId: string | null;
  /**
   * How voice picks its conversation: "resume" the exact remembered one,
   * "new" for a blank chat, or "continue" Nika's latest conversation.
   * Defaults to resume with an id, otherwise continue.
   */
  intent?: ConversationIntent;
  /** Each authoritative binding, so the app's current chat follows voice at once. */
  onSessionBound?: (sessionId: string) => void;
  /** The requested conversation is gone; the app should stop remembering it. */
  onSessionUnavailable?: () => void;
  onOpenConversations?: () => void;
  onExit: (sessionId: string | null) => void;
  onSwitchToKeyboard: (sessionId: string | null) => void;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function shouldShowVoiceStop(state: RealtimeState, actionPending: boolean): boolean {
  return actionPending || state === "thinking" || state === "responding";
}

/**
 * AVA's measured voice, scaled for her mouth and the island's bars. Only a real
 * measurement counts (contract face-signal v1); synthetic or no output returns
 * null so the face keeps its own declared rhythm. Read every animation frame,
 * never through React state.
 */
export function measuredVoiceLevel(): number | null {
  const sample = sampleFaceSignalLevels();
  if (sample.outputSource !== "measured") return null;
  return Math.min(1, sample.output * 3);
}

/** A click on Stop this soon after a hold-to-talk release came from that release. */
const STOP_AFTER_RELEASE_GUARD_MS = 600;

/**
 * Picks the voice engine for this visit: GPT-Live ("live", the default) or the
 * realtime engine. If GPT-Live cannot start, this visit falls back to the
 * standard engine without changing Sir's setting.
 */
export function VoiceScreen(props: VoiceScreenProps) {
  const [engine, setEngine] = useState<VoiceEngine | "fallback" | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchVoiceEngine()
      .then((e) => { if (alive) setEngine(e); })
      .catch(() => { if (alive) setEngine("openai"); });
    return () => { alive = false; };
  }, []);
  if (engine === null) return <VoiceConnecting />;
  if (engine === "live") return <LiveVoiceScreen {...props} onFallback={() => setEngine("fallback")} />;
  return <RealtimeVoiceScreen {...props} engineOverride={engine === "fallback" ? "openai" : undefined} />;
}

/**
 * While voice finds out which engine to use: calm and announced, with the
 * still face (a plain picture, no WebGL). No microphone or connection is
 * opened until an engine is chosen.
 */
function VoiceConnecting() {
  return (
    <div aria-busy="true" className="ds-root flex h-full flex-col items-center justify-center gap-5 bg-canvas px-6 font-ui text-ink">
      <StatusIsland mode="idle" text="Connecting" detail="voice" />
      <FaceStill size={200} label="AVA" />
      <p className="text-meta text-ink-2">Connecting to voice…</p>
    </div>
  );
}

function LiveVoiceScreen(props: VoiceScreenProps & { onFallback: () => void }) {
  const v = useLiveVoice({
    initialSessionId: props.initialSessionId,
    intent: props.intent,
    onSessionBound: props.onSessionBound,
    onFallback: props.onFallback,
  });
  return <VoiceScreenBody {...props} v={v} engineLabel="OPENAI · GPT-LIVE 1" />;
}

export function RealtimeVoiceScreen(props: VoiceScreenProps & { engineOverride?: "openai" | "hume" }) {
  const v = useRealtimeVoice({
    initialSessionId: props.initialSessionId,
    intent: props.intent,
    onSessionBound: props.onSessionBound,
    engineOverride: props.engineOverride,
  });
  return <VoiceScreenBody {...props} v={v} />;
}

const roundGlass = "ds-focus ds-glass grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink shadow-e1 transition-transform duration-150 active:scale-95";
const roundQuiet = "ds-focus grid h-12 w-12 shrink-0 place-items-center rounded-full text-ink transition-[transform,background-color] duration-150 hover:bg-glass active:scale-95";

/**
 * Voice (contract ui-remodel v3 §6): AVA's face fills the screen and moves with
 * what she is doing, the island says it in words, captions show the current
 * turn, and the controls sit in one bar at the bottom.
 */
export function VoiceScreenBody({
  initialSessionId,
  intent,
  onSessionBound,
  onSessionUnavailable,
  onOpenConversations,
  onExit,
  onSwitchToKeyboard,
  v,
  engineLabel,
}: VoiceScreenProps & { v: ReturnType<typeof useRealtimeVoice>; engineLabel?: string }) {
  void initialSessionId; void intent; void onSessionBound;
  const unavailableReportedRef = useRef(false);
  useEffect(() => {
    if (!v.unavailable) {
      unavailableReportedRef.current = false;
      return;
    }
    if (unavailableReportedRef.current) return;
    unavailableReportedRef.current = true;
    onSessionUnavailable?.();
  }, [onSessionUnavailable, v.unavailable]);
  const [secs, setSecs] = useState(0);
  const [exactTextOpen, setExactTextOpen] = useState(false);
  const mutedBeforeExactText = useRef(false);
  const exactTextTriggerRef = useRef<HTMLButtonElement>(null);
  const ptt = v.inputMode === "enter_push_to_talk";
  const capturing = v.capturing;
  const showStop = shouldShowVoiceStop(v.state, v.actionPending);
  // When the owner last released hold-to-talk; guards the Stop button that replaces it.
  const pttReleasedAtRef = useRef(0);
  const approvalTiming = useApprovalTiming(v.pendingApproval, v.pendingApproval != null);
  const approvalDeadlineCopy = v.pendingApproval
    ? pendingApprovalCopy(v.pendingApproval, approvalTiming)
    : null;
  // What AVA is audibly doing, from the shared face signal: speaking only while
  // her voice actually plays (contract face-signal v1). Low-frequency only.
  const signalMode = useSyncExternalStore(subscribeFaceSignalMode, getFaceSignalMode, getFaceSignalMode);
  const setExactTextDialogOpen = (open: boolean) => {
    if (open) {
      mutedBeforeExactText.current = v.muted;
      v.setMuted(true);
    } else {
      v.setMuted(mutedBeforeExactText.current);
    }
    setExactTextOpen(open);
  };
  const leaveVoice = (destination: "exit" | "keyboard") => {
    // The session hello updates a ref synchronously and React state on the next
    // render. Read the authoritative ref so an immediate Exit/Keyboard tap
    // cannot hand App the stale null that preceded a newly-created session.
    const sessionId = v.getSessionId();
    // Release the mic/socket immediately. The hook's unmount cleanup is a
    // second safety net for navigation paths outside these two buttons.
    v.stop();
    if (destination === "keyboard") onSwitchToKeyboard(sessionId);
    else onExit(sessionId);
  };

  useEffect(() => { v.start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Per-turn timer: count only while a turn is ACTUALLY capturing — hands-free:
  // while "listening"; hold-to-talk: only while a hold is in flight. Between
  // hold-to-talk turns the mic is closed, so the timer must not run.
  const timerActive = ptt ? (v.state === "listening" && capturing) : v.state === "listening";
  useEffect(() => {
    if (!timerActive) { setSecs(0); return; }
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  // What the island says. A decision waiting for Niko outranks everything, then
  // a running action, then what the voice is audibly doing.
  const island: { mode: IslandMode; text?: string; detail?: string } =
    exactTextOpen            ? { mode: "idle", text: "Exact text", detail: "mic paused" } :
    v.pendingApproval        ? { mode: "attention", detail: "say yes or no, or tap" } :
    v.actionPending          ? { mode: "working", detail: "your task" } :
    v.state === "connecting" ? { mode: "idle", text: "Connecting" } :
    signalMode === "speaking"  ? { mode: "speaking" } :
    signalMode === "thinking"  ? { mode: "thinking" } :
    signalMode === "listening" ? { mode: "listening", detail: formatTime(secs) } :
    v.state === "listening" && ptt ? { mode: "idle", text: "Hold to talk" } :
                                 { mode: "idle", text: "Ready" };

  // The friendly line under the face. Honest about hold-to-talk idle (mic closed).
  const statusLabel =
    exactTextOpen           ? "Typing exact wording · nothing sent yet" :
    v.actionPending         ? "Working on your task…" :
    v.state === "connecting" ? "Connecting…" :
    v.state === "thinking"   ? "Thinking…" :
    v.state === "responding" ? "Ava speaking" :
    v.state === "listening"  ? (ptt && !capturing ? "Hold to talk · Space" : `Listening · ${formatTime(secs)}`) :
                                "Ready";

  // The face poses for the same audible truth; a running action reads as thinking.
  const faceMode = v.actionPending && signalMode !== "speaking" ? "thinking" : signalMode;

  return (
    <div className="ds-root relative flex h-full w-full flex-col overflow-hidden bg-canvas font-ui text-ink">
      {/* Top: the compact menu button sits top-left (the app's bar); voice's own
          actions sit top-right; the island is centred under them. */}
      <div
        className="relative z-30 flex shrink-0 items-start justify-end gap-2 px-3"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        <button
          onClick={() => window.open(
            "/?mission-control=1",
            "ava-mission-control",
            "popup,width=1500,height=920,resizable=yes,scrollbars=no",
          )}
          aria-label="open Mission Control"
          title="Open Mission Control beside voice"
          className={roundGlass}
        >
          <PanelsTopLeft size={18} aria-hidden="true" />
        </button>
        {/* Voice resumes your latest chat by default, so this is how you deliberately start fresh. */}
        <button onClick={() => v.newConversation()} aria-label="new conversation" title="New conversation" className={roundGlass}>
          <MessageSquarePlus size={18} aria-hidden="true" />
        </button>
        <button onClick={() => leaveVoice("exit")} aria-label="exit" title="Leave voice" className={roundGlass}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="relative z-20 flex shrink-0 justify-center px-4 pt-3">
        <StatusIsland mode={island.mode} text={island.text} detail={island.detail} sampleLevel={measuredVoiceLevel} />
      </div>

      {v.errorMsg && !v.unavailable && (
        <div role="alert" className="relative z-40 mx-auto mt-3 flex w-[min(420px,calc(100%-2rem))] items-start gap-3 rounded-card bg-danger-soft px-4 py-3 text-meta text-ink shadow-e2">
          <span className="min-w-0 flex-1">{v.errorMsg}</span>
          {/* Dismiss only clears the error — exiting voice is the X button's job. */}
          <button type="button" onClick={v.clearError} aria-label="Dismiss" className="ds-focus -m-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-glass">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* The exact conversation is gone. Voice never switches on its own; Nika chooses. */}
      {v.unavailable && (
        <div role="alert" className="relative z-40 mx-auto mt-3 grid w-[min(380px,calc(100%-2rem))] justify-items-center gap-2 rounded-card bg-raised p-5 text-center shadow-e3">
          <p className="text-body-lg text-ink">This conversation is unavailable.</p>
          <p className="text-meta text-ink-2">It may have been deleted. Start a new conversation or pick one of yours.</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button variant="solid" size="sm" onClick={() => v.newConversation()}>Start a new conversation</Button>
            {onOpenConversations && (
              <Button variant="glass" size="sm" onClick={() => { v.stop(); onOpenConversations(); }}>Your conversations</Button>
            )}
          </div>
        </div>
      )}

      {/* One calm, full-height stage: her face, then the current turn in words.
          Voice has no transcript scroller; the full history is in Talk. */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 pb-2">
        <div className="ds-backlight relative h-[min(50dvh,520px)] w-full max-w-2xl">
          <LazyFace mode={faceMode} sampleLevel={measuredVoiceLevel} label="AVA" stillSize={240} className="relative" />
        </div>

        <p className="text-meta text-ink-2">{statusLabel}</p>

        {/* ONE live line for the current turn, updated in place as it streams. */}
        <div className="min-h-[5.5rem] w-full max-w-2xl text-center" aria-live="polite" aria-label="Current voice turn">
          {v.interim && (
            <div key={`interim-${v.interim.who}`} className="ds-rise grid gap-1.5">
              <span className="font-ui-mono text-label uppercase text-ink-3">
                {v.interim.who === "you"
                  ? (v.interim.inputSource === "voice_exact_text" ? "you · exact text" : "you")
                  : "ava"}
              </span>
              <span className="line-clamp-4 text-heading font-medium text-ink">{v.interim.text}</span>
            </div>
          )}
          {!v.interim && v.hint && <p className="text-body text-ink-2">{v.hint}</p>}
          {!v.interim && !v.hint && !ptt && v.state === "responding" && (
            <p className="text-meta text-ink-3">Talk any time to interrupt.</p>
          )}
        </div>
      </main>

      {v.pendingApproval && (
        <div
          role="region"
          aria-label="Approval required"
          className="ds-rise relative z-40 mx-auto mb-3 grid w-[min(380px,calc(100%-2rem))] gap-2 rounded-card bg-raised p-5 text-center shadow-e3"
        >
          <p className="font-ui-mono text-label uppercase text-ink-3">
            {approvalRiskLabel(v.pendingApproval)} · {approvalTimeoutLabel(v.pendingApproval)}
          </p>
          <p className="text-body-lg text-ink">{v.pendingApproval.summary}</p>
          <p className="text-meta text-ink-2">Say “yes” to approve or “no” to deny — or tap.</p>
          <p className="text-meta font-medium text-warning" role="status" aria-live="polite" aria-atomic="true">
            {approvalDeadlineCopy}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Button variant="glass" onClick={v.deny}>Deny</Button>
            <Button variant="solid" onClick={v.approve}>Approve</Button>
          </div>
        </div>
      )}

      {/* The control bar: engine and input mode, then one pill with the controls. */}
      <div
        className="relative z-20 flex shrink-0 flex-col items-center gap-3 px-3 pt-1"
        // Bottom padding plus the home-indicator inset on phones (env() is 0 on desktop).
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* AVA is pinned to one engine per visit; there is no engine switch here. */}
          <span
            className="rounded-full bg-glass px-3 py-1.5 font-ui-mono text-label text-ink-2"
            aria-label={v.voiceEngine === "hume" ? "Hume EVI voice" : "OpenAI GPT Realtime 2.1 voice"}
          >
            {engineLabel ?? (v.voiceEngine === "hume" ? "HUME · EVI" : "OPENAI · REALTIME 2.1")}
          </span>
          {/* Input mode: hands-free ↔ hold-to-talk. Persisted by the hook. */}
          <div className="flex items-center gap-1 rounded-full bg-glass p-1">
            <button
              aria-label="hands-free voice mode"
              aria-pressed={!ptt}
              onClick={() => v.setInputMode("vad")}
              className={cn("ds-focus rounded-full px-3 py-1.5 text-meta transition-colors", !ptt ? "bg-solid text-on-solid" : "text-ink-2 hover:text-ink")}
            >
              Hands-free
            </button>
            <button
              aria-label="push to talk mode"
              aria-pressed={ptt}
              onClick={() => v.setInputMode("enter_push_to_talk")}
              className={cn("ds-focus rounded-full px-3 py-1.5 text-meta transition-colors", ptt ? "bg-solid text-on-solid" : "text-ink-2 hover:text-ink")}
            >
              Hold-to-talk
            </button>
          </div>
        </div>

        {/* mute · (talk / stop) · exact text · keyboard */}
        <div className="ds-glass flex items-center gap-2 rounded-full p-2 shadow-e3">
          <button aria-label={v.muted ? "unmute" : "mute"} onClick={() => v.setMuted(!v.muted)} className={roundQuiet}>
            {v.muted ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
          </button>
          {showStop ? (
            <button
              aria-label={v.actionPending ? "stop current action" : "interrupt Ava"}
              onClick={() => {
                // Stop takes the hold button's place the instant a turn is sent; a
                // click that lands within moments of release belongs to that
                // release (phones synthesize one), not to a decision to stop.
                if (Date.now() - pttReleasedAtRef.current < STOP_AFTER_RELEASE_GUARD_MS) return;
                v.interrupt();
              }}
              className="ds-focus grid h-16 w-16 place-items-center rounded-full bg-solid text-on-solid shadow-e2 transition-transform duration-150 active:scale-95"
            >
              <Square size={20} fill="currentColor" aria-hidden="true" />
            </button>
          ) : ptt ? (
            <HoldToTalkButton
              capturing={capturing}
              onStart={v.startPtt}
              onFinish={() => {
                pttReleasedAtRef.current = Date.now();
                v.finishPtt();
              }}
            />
          ) : (
            // Hands-free: the mic is open; this shows it, it is not a control.
            <div
              aria-hidden="true"
              data-listening={v.state === "listening" || undefined}
              className="grid h-16 w-16 place-items-center rounded-full bg-solid text-on-solid shadow-e2 transition-transform duration-240 data-[listening]:scale-105"
            >
              <Mic size={22} />
            </div>
          )}
          <button
            ref={exactTextTriggerRef}
            aria-label="type exact text in voice"
            aria-haspopup="dialog"
            aria-expanded={exactTextOpen}
            onClick={() => setExactTextDialogOpen(true)}
            className={roundQuiet}
            title="Type an exact name, username, URL, code, or correction"
          >
            <Type size={20} aria-hidden="true" />
          </button>
          <button aria-label="keyboard" onClick={() => leaveVoice("keyboard")} className={roundQuiet} title="Continue in Talk">
            <Keyboard size={20} aria-hidden="true" />
          </button>
        </div>

        {ptt && v.state !== "responding" && (
          <p className="text-meta text-ink-3">Hold the mic or Space to talk · release to send</p>
        )}
      </div>
      <VoiceExactTextDialog
        open={exactTextOpen}
        onOpenChange={setExactTextDialogOpen}
        onSubmit={v.submitExactText}
        sessionReady={v.sessionId !== null && v.state !== "connecting"}
        returnFocusRef={exactTextTriggerRef}
      />
    </div>
  );
}
