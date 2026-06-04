import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Pulse } from "../components/ava/Pulse.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { useRealtimeVoice } from "./useRealtimeVoice.js";
import { useMicAmplitude } from "./useMicAmplitude.js";
import { Mic, Keyboard, MicOff, Pause, X } from "lucide-react";
import { gsap, shouldReduceMotion, useGSAP } from "../lib/gsap.js";

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

export function VoiceScreen({ initialSessionId, onExit, onSwitchToKeyboard }: VoiceScreenProps) {
  const v = useRealtimeVoice({ initialSessionId });
  const amp = useMicAmplitude(v.state === "listening" && !v.muted);
  const [secs, setSecs] = useState(0);
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => { v.start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (v.state !== "listening") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [v.state]);

  useEffect(() => {
    if (v.state === "idle") setSecs(0);
  }, [v.state]);

  useGSAP(() => {
    if (!scope.current || shouldReduceMotion()) return;
    gsap.fromTo(
      ".voice-reveal",
      { autoAlpha: 0, y: 16, filter: "blur(12px)" },
      { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.72, stagger: 0.06, ease: "power3.out" },
    );
    gsap.fromTo(
      ".voice-rule",
      { scaleX: 0, transformOrigin: "center" },
      { scaleX: 1, duration: 0.9, ease: "power3.out" },
    );
  }, { scope });

  const stateLabel =
    v.state === "connecting" ? "CONNECTING..." :
    v.state === "listening" ? `LISTENING / ${formatTime(secs)}` :
    v.state === "thinking" ? "THINKING..." :
    v.state === "responding" ? "AVA / SPEAKING" :
    "READY";

  const tintColor =
    v.state === "responding" ? "rgba(93,124,255,0.16)" :
    v.state === "thinking" ? "rgba(216,189,131,0.14)" :
    v.state === "listening" ? "rgba(71,214,167,0.13)" :
    "rgba(247,239,226,0.06)";

  return (
    <div
      ref={scope}
      className="ava-luxe-screen"
      style={{
        background:
          `radial-gradient(circle at 50% 42%, ${tintColor} 0%, rgba(0,0,0,0) 42%), `
          + "linear-gradient(115deg, rgba(216,189,131,0.10), transparent 36%), "
          + "linear-gradient(245deg, rgba(71,214,167,0.08), transparent 42%), #040404",
        transition: "background 600ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div className="voice-reveal absolute left-5 top-5 z-20">
        <div className="ava-kicker mb-2">voice atelier</div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--ava-fg-muted)]">{stateLabel}</div>
      </div>
      <button
        onClick={() => onExit(v.sessionId)}
        aria-label="exit"
        className="ava-icon-button voice-reveal absolute right-5 top-5 z-20"
      >
        <X size={14} />
      </button>

      <div className="voice-reveal pointer-events-none absolute inset-x-8 top-[15%] z-10 text-center">
        <div className="voice-rule mx-auto mb-5 h-px max-w-[420px] bg-gradient-to-r from-transparent via-[var(--ava-champagne)] to-transparent" />
        <div className="ava-metal-wordmark text-5xl font-semibold tracking-[0.2em] sm:text-7xl">AVA</div>
      </div>

      <motion.div
        className="voice-reveal absolute left-1/2 top-[44%] h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(216,189,131,0.13)] sm:h-[360px] sm:w-[360px]"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.15 : 1 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        className="voice-reveal absolute left-1/2 top-[44%] h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(247,239,226,0.14)] sm:h-[270px] sm:w-[270px]"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.25 : 1 }}
        transition={{ duration: 0.12 }}
      />
      <motion.div
        className="voice-reveal absolute left-1/2 top-[44%] h-[164px] w-[164px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(71,214,167,0.24)] sm:h-[190px] sm:w-[190px]"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.4 : 1 }}
        transition={{ duration: 0.1 }}
      />

      <div className="voice-reveal absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2">
        <Pulse
          layoutId="ava-pulse"
          state={
            v.state === "listening" ? "listening"
            : v.state === "thinking" ? "thinking"
            : v.state === "responding" ? "responding"
            : "idle"
          }
          size={120}
          amplitude={amp}
        />
      </div>

      {v.caption && (
        <motion.div
          key={`${v.caption.who}-${v.caption.text}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-[170px] left-0 right-0 z-20 px-6 text-center"
        >
          <div className="ava-kicker mb-2">{v.caption.who === "you" ? "you" : "ava"}</div>
          <div className="mx-auto max-w-[320px] text-sm leading-snug text-[var(--ava-ink)]">{v.caption.text}</div>
        </motion.div>
      )}

      {v.pendingApproval && (
        <div className="ava-glass-panel absolute bottom-[230px] left-1/2 z-30 w-[300px] -translate-x-1/2 p-4 text-center">
          <div className="ava-section-label">approval needed</div>
          <div className="mb-3 text-sm leading-snug text-[var(--ava-ink)]">{v.pendingApproval.summary}</div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={v.deny}
              className="ava-secondary-button px-4 py-2 text-xs"
            >
              Deny
            </button>
            <button
              onClick={v.approve}
              className="ava-primary-button px-4 py-2 text-xs font-medium"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {v.errorMsg && (
        <div className="absolute left-1/2 top-20 z-40 w-72 -translate-x-1/2">
          <Alert variant="destructive" close onClose={() => onExit(v.sessionId)}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="voice-reveal absolute bottom-8 left-0 right-0 z-20 flex items-center justify-center gap-5">
        <button
          aria-label={v.muted ? "unmute" : "mute"}
          onClick={() => v.setMuted(!v.muted)}
          className="ava-icon-button h-12 w-12"
        >
          {v.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {v.state === "responding" ? (
          <button
            aria-label="interrupt"
            onClick={v.interrupt}
            className="ava-primary-button flex h-16 w-16 items-center justify-center rounded-full active:scale-95"
          >
            <Pause size={20} />
          </button>
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background:
                "linear-gradient(135deg, rgba(247,239,226,0.18), rgba(216,189,131,0.06))",
              border: "1px solid rgba(216,189,131,0.22)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              boxShadow: v.state === "listening"
                ? "0 0 24px rgba(71,214,167,0.25)"
                : undefined,
            }}
          >
            <Mic size={20} className="text-[var(--ava-ink)] opacity-85" />
          </div>
        )}
        <button
          aria-label="keyboard"
          onClick={() => onSwitchToKeyboard(v.sessionId)}
          className="ava-icon-button h-12 w-12"
        >
          <Keyboard size={18} />
        </button>
      </div>
    </div>
  );
}
