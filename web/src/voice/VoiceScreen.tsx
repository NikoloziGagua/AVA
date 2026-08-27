import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Orb } from "../components/ava/Orb.js";
import { MagicRings } from "../components/ava/MagicRings.js";
import { NebulaBackground } from "../components/ava/NebulaBackground.js";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { gsap, useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { useRealtimeVoice, type RealtimeState } from "./useRealtimeVoice.js";
import { Mic, Keyboard, MicOff, Square, X, MessageSquarePlus, PanelsTopLeft } from "lucide-react";

export interface VoiceScreenProps {
  initialSessionId: string | null;
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

export function VoiceScreen({ initialSessionId, onExit, onSwitchToKeyboard }: VoiceScreenProps) {
  const v = useRealtimeVoice({ initialSessionId });
  const [secs, setSecs] = useState(0);
  const chromeScope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const ptt = v.inputMode === "enter_push_to_talk";
  const capturing = v.capturing;
  const showStop = shouldShowVoiceStop(v.state, v.actionPending);
  const leaveVoice = (destination: "exit" | "keyboard") => {
    const sessionId = v.sessionId;
    // Release the mic/socket immediately. The hook's unmount cleanup is a
    // second safety net for navigation paths outside these two buttons.
    v.stop();
    if (destination === "keyboard") onSwitchToKeyboard(sessionId);
    else onExit(sessionId);
  };

  // Slowly rotate the living-chrome conic angle on the RESTING CTA (idle mic disc /
  // inactive push-to-talk). One transform-free CSS-var tween over the whole control
  // row; targets only elements carrying .liquid-chrome, so the active/interrupt
  // states (which never get that class) are untouched. Reduced motion → no spin.
  useGSAP(
    () => {
      if (reduced) return;
      gsap.fromTo(
        ".liquid-chrome",
        { "--chrome-angle": "0deg" },
        { "--chrome-angle": "360deg", duration: 14, ease: "none", repeat: -1 },
      );
    },
    { scope: chromeScope, dependencies: [reduced, v.state, ptt, capturing] },
  );

  useEffect(() => { v.start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Per-turn timer (Fix): count only while a turn is ACTUALLY capturing — VAD:
  // while "listening"; PTT: only while a hold is in flight (capturing). Between PTT
  // turns the mic is closed, so the timer must not run and the orb must not look
  // like it's listening. Resetting to 0 whenever capture stops makes it per-turn.
  const timerActive = ptt ? (v.state === "listening" && capturing) : v.state === "listening";
  useEffect(() => {
    if (!timerActive) { setSecs(0); return; }
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  // Compact uppercase HUD (top-left) — honest about PTT idle (mic closed).
  const hudLabel =
    v.actionPending         ? "AVA · WORKING" :
    v.state === "connecting" ? "CONNECTING" :
    v.state === "thinking"   ? "THINKING" :
    v.state === "responding" ? "AVA · SPEAKING" :
    v.state === "listening"  ? (ptt && !capturing ? "PUSH-TO-TALK" : "LISTENING") :
                                "READY";

  // Friendly status chip under the orb.
  const statusLabel =
    v.actionPending         ? "Working on your task…" :
    v.state === "connecting" ? "Connecting…" :
    v.state === "thinking"   ? "Thinking…" :
    v.state === "responding" ? "Ava speaking" :
    v.state === "listening"  ? (ptt && !capturing ? "Hold to talk · Space" : `Listening · ${formatTime(secs)}`) :
                                "Ready";

  // Orb reacts only when audio is truly forwarding: PTT-idle shows the calm "idle"
  // orb (mic closed between turns), not the reactive "listening" one.
  const orbState =
    v.actionPending         ? "thinking" :
    v.state === "responding" ? "responding" :
    v.state === "thinking"   ? "thinking" :
    v.state === "listening"  ? (ptt && !capturing ? "idle" : "listening") :
                                "idle";

  const tint =
    v.actionPending         ? "rgba(92,242,255,0.12)" :
    v.state === "responding" ? "rgba(34,150,255,0.20)" :
    v.state === "listening"  ? (ptt && !capturing ? "rgba(92,242,255,0.05)" : "rgba(124,92,255,0.18)") :
    v.state === "thinking"   ? "rgba(92,242,255,0.12)" :
                                "rgba(92,242,255,0.05)";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <DottedSurface />
      <NebulaBackground />
      {/* per-state tint, eased */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 38%, ${tint} 0%, transparent 60%)`,
          transition: "background 600ms cubic-bezier(0.22,1,0.36,1)",
        }}
      />

      <div className="hud absolute left-5 top-5 z-20 text-[10px]" style={{ color: "var(--ac)" }}>{hudLabel}</div>
      <button
        onClick={() => window.open(
          "/?mission-control=1",
          "ava-mission-control",
          "popup,width=1500,height=920,resizable=yes,scrollbars=no",
        )}
        aria-label="open Mission Control"
        title="Open Mission Control beside voice"
        className="absolute right-28 top-5 z-30 flex h-8 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-[9px] uppercase tracking-wider text-white/60 transition-all hover:text-white active:scale-95"
      >
        <PanelsTopLeft size={13} />
        Activity
      </button>
      {/* New conversation: voice resumes your latest chat by default, so this is
          how you deliberately start fresh. */}
      <button
        onClick={() => v.newConversation()}
        aria-label="new conversation"
        title="New conversation"
        className="absolute right-16 top-5 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-all active:scale-95"
      >
        <MessageSquarePlus size={14} />
      </button>
      <button
        onClick={() => leaveVoice("exit")}
        aria-label="exit"
        className="absolute right-5 top-5 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70"
      >
        <X size={14} />
      </button>

      {v.errorMsg && (
        <div className="absolute left-1/2 top-16 z-40 w-72 -translate-x-1/2">
          {/* Dismiss only clears the error — exiting voice is the X button's job. */}
          <Alert variant="destructive" close onClose={v.clearError}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* One calm, full-height stage. Voice mode intentionally has no transcript
          scroller; complete history remains in keyboard mode. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-4 pt-20">
        {/* MagicRings is a separate LIGHT GSAP+SVG layer BEHIND the orb on the SAME
            center, pointer-events-none. The orb Flips in from the home hero. */}
        <div className="relative">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2">
            <MagicRings size={160} state={orbState} amplitude={v.amplitude} />
          </div>
          <Orb size={160} state={orbState} amplitude={v.amplitude} flipId="ava-orb" />
        </div>

        <div className="hud mt-6 text-[11px]" style={{ color: "var(--ac)" }}>{statusLabel}</div>

        {/* ONE live interim line — STABLE key (per who, not per token), so the
            entrance runs once per new turn and streaming text updates in place
            instead of remounting + replaying the blur/fade on every delta. */}
        <div
          className="mt-5 min-h-[6.5rem] w-full max-w-3xl text-center"
          aria-live="polite"
          aria-label="Current voice turn"
        >
          {v.interim && (
            <motion.div
              key={`interim-${v.interim.who}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="hud mb-1 text-[9px] text-white/40">{v.interim.who === "you" ? "you" : "ava"}</div>
              <div
                className="mx-auto overflow-hidden text-[clamp(18px,2.2vw,26px)] leading-snug text-white/80"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {v.interim.text}
              </div>
            </motion.div>
          )}
          {!v.interim && v.hint && (
            <div className="mx-auto text-[14px] leading-snug text-white/45">{v.hint}</div>
          )}
          {!v.interim && !v.hint && !ptt && v.state === "responding" && (
            <div className="mx-auto text-[12px] leading-snug text-white/30">Talk any time to interrupt.</div>
          )}
        </div>
      </div>

      {v.pendingApproval && (
        <div
          className="glass absolute bottom-[220px] left-1/2 z-40 w-[340px] -translate-x-1/2 rounded-2xl p-4 text-center"
          style={{ borderColor: "rgba(92,242,255,0.3)" }}
        >
          <div className="hud mb-1 text-[9px]" style={{ color: "var(--ac)" }}>⚑ approval needed</div>
          <div className="mb-1 text-sm leading-snug text-white/90">{v.pendingApproval.summary}</div>
          <div className="mb-3 text-[11px] text-white/50">
            Say <b style={{ color: "var(--ac-live)" }}>“yes”</b> to approve or <b style={{ color: "var(--ac-live)" }}>“no”</b> to deny — or tap.
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={v.deny} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-white/80 active:scale-95">Deny</button>
            <button onClick={v.approve} className="rounded-full px-4 py-2 text-xs font-medium active:scale-95" style={{ background: "var(--ac)", color: "#04222a" }}>Approve</button>
          </div>
        </div>
      )}

      {/* ── CONTROL BAR ──────────────────────────────────────────────────────── */}
      <div
        className="relative z-20 flex shrink-0 flex-col items-center gap-4 pt-3"
        // bottom padding plus the home-indicator inset on phones (env() is 0 on desktop).
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        {/* Provider badge + input mode. AVA is pinned to OpenAI's newest public
            Realtime model; removing the engine switch prevents accidental voice
            changes between sessions. */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div
            className="glass rounded-full px-3 py-1.5 text-[10px] text-white/55"
            aria-label="OpenAI GPT Realtime 2.1 voice"
          >
            OPENAI · REALTIME 2.1
          </div>

          {/* Input-mode toggle: hands-free VAD ↔ hold-to-talk. Persisted. */}
          <div className="glass flex items-center gap-1 rounded-full p-1 text-[10px]">
            <button
              aria-label="hands-free voice mode"
              aria-pressed={!ptt}
              onClick={() => v.setInputMode("vad")}
              className="rounded-full px-3 py-1 transition-all"
              style={!ptt ? { background: "var(--ac)", color: "#04222a" } : { color: "rgba(255,255,255,0.6)" }}
            >
              Hands-free
            </button>
            <button
              aria-label="push to talk mode"
              aria-pressed={ptt}
              onClick={() => v.setInputMode("enter_push_to_talk")}
              className="rounded-full px-3 py-1 transition-all"
              style={ptt ? { background: "var(--ac)", color: "#04222a" } : { color: "rgba(255,255,255,0.6)" }}
            >
              Hold-to-talk
            </button>
          </div>
        </div>

        {/* Primary control row: mute · (talk / interrupt) · keyboard. */}
        <div ref={chromeScope} className="flex items-center justify-center gap-5">
          <button
            aria-label={v.muted ? "unmute" : "mute"}
            onClick={() => v.setMuted(!v.muted)}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-all active:scale-95"
          >
            {v.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          {showStop ? (
            <button
              aria-label={v.actionPending ? "stop current action" : "interrupt Ava"}
              onClick={v.interrupt}
              className="flex h-16 w-16 items-center justify-center rounded-full active:scale-95"
              style={{ background: "var(--ac)", color: "#04222a", boxShadow: "0 0 26px rgba(92,242,255,0.5)" }}
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : ptt ? (
            // TRUE hold-to-talk: press-AND-hold to talk, release to send. Pointer
            // Events serve mouse + touch from one path; setPointerCapture keeps the
            // pointerup on THIS element even if the pointer drifts off mid-hold (the
            // classic "released and nothing sent" bug). onPointerLeave/Cancel are the
            // fallback commit when pointer capture isn't available.
            <button
              aria-label={capturing ? "release to send" : "hold to talk"}
              onPointerDown={(e) => {
                e.preventDefault();
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
                v.startPtt();
              }}
              onPointerUp={(e) => {
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
                v.finishPtt();
              }}
              onPointerCancel={() => v.finishPtt()}
              onPointerLeave={() => v.finishPtt()}
              onContextMenu={(e) => e.preventDefault()}
              // Capturing = active (solid cyan + glow). ARMED-but-idle push-to-talk
              // gets the calm living-chrome surface (class provides bg + border + sheen).
              className={`flex h-16 w-16 select-none items-center justify-center rounded-full transition-all active:scale-95${capturing ? "" : " liquid-chrome"}`}
              style={
                capturing
                  ? { background: "var(--ac)", border: "1px solid rgba(255,255,255,0.18)", color: "#04222a", boxShadow: "0 0 26px rgba(92,242,255,0.5)", touchAction: "none" }
                  : { touchAction: "none" }
              }
            >
              <Mic size={20} className={capturing ? "" : "text-[#0c2a31]"} />
            </button>
          ) : (
            // Hands-free idle mic disc — resting affordance, gets the living-chrome surface.
            <div
              aria-hidden="true"
              className="liquid-chrome flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                boxShadow: v.state === "listening" ? "0 0 24px rgba(92,242,255,0.3)" : undefined,
              }}
            >
              <Mic size={20} className="text-[#0c2a31]" />
            </div>
          )}
          <button
            aria-label="keyboard"
            onClick={() => leaveVoice("keyboard")}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-all active:scale-95"
          >
            <Keyboard size={18} />
          </button>
        </div>

        {/* Gesture hint for the hold model. */}
        {ptt && v.state !== "responding" && (
          <div className="hud text-[9px] text-white/30">Hold the mic or Space to talk · release to send</div>
        )}
      </div>
    </div>
  );
}
