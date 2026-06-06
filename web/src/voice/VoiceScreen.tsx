import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Orb } from "../components/ava/Orb.js";
import { NebulaBackground } from "../components/ava/NebulaBackground.js";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { useRealtimeVoice } from "./useRealtimeVoice.js";
import { useMicAmplitude } from "./useMicAmplitude.js";
import { Mic, Keyboard, MicOff, Pause, X } from "lucide-react";

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

  useEffect(() => { v.start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (v.state !== "listening") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [v.state]);
  useEffect(() => { if (v.state === "idle") setSecs(0); }, [v.state]);

  const ptt = v.inputMode === "enter_push_to_talk";
  const stateLabel =
    v.state === "connecting" ? "CONNECTING…" :
    v.state === "listening"  ? (ptt && !v.capturing ? "PUSH TO TALK · ↵" : `LISTENING · ${formatTime(secs)}`) :
    v.state === "thinking"   ? "THINKING…" :
    v.state === "responding" ? "AVA · SPEAKING" :
                                "READY";

  const orbState =
    v.state === "listening" ? "listening" :
    v.state === "thinking"  ? "thinking" :
    v.state === "responding" ? "responding" :
                                "idle";

  const tint =
    v.state === "responding" ? "rgba(34,150,255,0.20)" :
    v.state === "listening"  ? "rgba(124,92,255,0.18)" :
    v.state === "thinking"   ? "rgba(92,242,255,0.12)" :
                                "rgba(92,242,255,0.05)";

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <DottedSurface />
      <NebulaBackground />
      {/* per-state tint, eased */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 42%, ${tint} 0%, transparent 60%)`,
          transition: "background 600ms cubic-bezier(0.22,1,0.36,1)",
        }}
      />

      <div className="hud absolute left-5 top-5 z-20 text-[10px]" style={{ color: "var(--ac)" }}>{stateLabel}</div>
      <button
        onClick={() => onExit(v.sessionId)}
        aria-label="exit"
        className="absolute right-5 top-5 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70"
      >
        <X size={14} />
      </button>

      {/* the living orb — Flips in from the home hero (Phase 5) */}
      <div className="absolute left-1/2 top-[42%] z-10 -translate-x-1/2 -translate-y-1/2">
        <Orb size={160} state={orbState} amplitude={amp} flipId="ava-orb" />
      </div>

      {v.caption && (
        <motion.div
          key={`${v.caption.who}-${v.caption.text}`}
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          className="absolute bottom-[170px] left-0 right-0 z-20 px-6 text-center"
        >
          <div className="hud mb-2 text-[9px] text-white/40">{v.caption.who === "you" ? "you" : "ava"}</div>
          <div className="mx-auto max-w-[340px] text-[15px] leading-snug text-white/90">{v.caption.text}</div>
        </motion.div>
      )}

      {v.pendingApproval && (
        <div
          className="glass absolute bottom-[230px] left-1/2 z-30 w-[320px] -translate-x-1/2 rounded-2xl p-4 text-center"
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

      {v.errorMsg && (
        <div className="absolute left-1/2 top-20 z-30 w-72 -translate-x-1/2">
          <Alert variant="destructive" close onClose={() => onExit(v.sessionId)}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Voice-engine toggle: how Ava's voice is produced. Server-persisted;
          changing it reconnects so the realtime speaks/transcribe mode applies. */}
      <div className="absolute bottom-40 left-0 right-0 z-20 flex items-center justify-center">
        <div className="glass flex items-center gap-1 rounded-full p-1 text-[10px]">
          {([
            ["openai", "OpenAI"],
            ["chatterbox", "Chatterbox"],
            ["hybrid", "Hybrid"],
          ] as const).map(([value, label]) => {
            const active = v.voiceEngine === value;
            return (
              <button
                key={value}
                aria-label={`${label} voice engine`}
                aria-pressed={active}
                onClick={() => v.setVoiceEngine(value)}
                className="rounded-full px-3 py-1 transition-all"
                style={active ? { background: "var(--ac)", color: "#04222a" } : { color: "rgba(255,255,255,0.6)" }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Input-mode toggle: hands-free VAD ↔ Enter push-to-talk. Persisted. */}
      <div className="absolute bottom-28 left-0 right-0 z-20 flex items-center justify-center">
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
            Push-to-talk ↵
          </button>
        </div>
      </div>

      <div className="absolute bottom-8 left-0 right-0 z-20 flex items-center justify-center gap-5">
        <button
          aria-label={v.muted ? "unmute" : "mute"}
          onClick={() => v.setMuted(!v.muted)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-all active:scale-95"
        >
          {v.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {v.state === "responding" ? (
          <button
            aria-label="interrupt"
            onClick={v.interrupt}
            className="flex h-16 w-16 items-center justify-center rounded-full active:scale-95"
            style={{ background: "var(--ac)", color: "#04222a", boxShadow: "0 0 26px rgba(92,242,255,0.5)" }}
          >
            <Pause size={20} />
          </button>
        ) : ptt ? (
          <button
            aria-label={v.capturing ? "finish turn" : "start turn"}
            onClick={v.togglePushToTalk}
            className="flex h-16 w-16 items-center justify-center rounded-full transition-all active:scale-95"
            style={{
              background: v.capturing ? "var(--ac)" : "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
              border: "1px solid rgba(255,255,255,0.18)",
              color: v.capturing ? "#04222a" : undefined,
              boxShadow: v.capturing ? "0 0 26px rgba(92,242,255,0.5)" : undefined,
            }}
          >
            <Mic size={20} className={v.capturing ? "" : "text-white/85"} />
          </button>
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
              border: "1px solid rgba(255,255,255,0.18)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              boxShadow: v.state === "listening" ? "0 0 24px rgba(92,242,255,0.3)" : undefined,
            }}
          >
            <Mic size={20} className="text-white/85" />
          </div>
        )}
        <button
          aria-label="keyboard"
          onClick={() => onSwitchToKeyboard(v.sessionId)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-all active:scale-95"
        >
          <Keyboard size={18} />
        </button>
      </div>
    </div>
  );
}
