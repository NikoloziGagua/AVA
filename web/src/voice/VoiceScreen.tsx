import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Pulse } from "../components/ava/Pulse.js";
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

  const stateLabel =
    v.state === "connecting" ? "CONNECTING…" :
    v.state === "listening"  ? `LISTENING · ${formatTime(secs)}` :
    v.state === "thinking"   ? "THINKING…" :
    v.state === "responding" ? "AVA · SPEAKING" :
                                "READY";

  const tintColor =
    v.state === "responding" ? "#0b1a2e" :
    v.state === "thinking"   ? "#1a1a1a" :
    v.state === "listening"  ? "#1a0b2e" :
                                "#0a0a14";

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-black"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 42%, ${tintColor} 0%, #000 70%)`,
        transition: "background-image 600ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div className="absolute top-5 left-5 text-[9px] tracking-[0.2em] uppercase text-white/50">{stateLabel}</div>
      <button
        onClick={() => onExit(v.sessionId)}
        aria-label="exit"
        className="absolute top-5 right-5 w-8 h-8 rounded-full border border-white/15 bg-white/5 text-white/70 flex items-center justify-center"
      >
        <X size={14} />
      </button>

      <motion.div
        className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-full border border-white/10"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.15 : 1 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-full border border-white/15"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.25 : 1 }}
        transition={{ duration: 0.12 }}
      />
      <motion.div
        className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] rounded-full border border-white/25"
        animate={{ scale: v.state === "listening" ? 1 + amp * 0.4 : 1 }}
        transition={{ duration: 0.1 }}
      />

      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
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
          className="absolute left-0 right-0 bottom-[170px] px-6 text-center"
        >
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40 mb-2">{v.caption.who === "you" ? "you" : "ava"}</div>
          <div className="text-sm text-white/90 leading-snug max-w-[280px] mx-auto">{v.caption.text}</div>
        </motion.div>
      )}

      {v.pendingApproval && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[230px] w-[300px] rounded-2xl border border-white/15 bg-white/5 backdrop-blur-md p-4 text-center">
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40 mb-1">approval needed</div>
          <div className="text-sm text-white/90 leading-snug mb-3">{v.pendingApproval.summary}</div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={v.deny}
              className="px-4 py-2 rounded-full border border-white/15 bg-white/5 text-white/80 text-xs active:scale-95"
            >
              Deny
            </button>
            <button
              onClick={v.approve}
              className="px-4 py-2 rounded-full bg-white text-black text-xs font-medium active:scale-95"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {v.errorMsg && (
        <div className="absolute left-1/2 -translate-x-1/2 top-20 w-72">
          <Alert variant="destructive" close onClose={() => onExit(v.sessionId)}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="absolute left-0 right-0 bottom-8 flex items-center justify-center gap-5">
        <button
          aria-label={v.muted ? "unmute" : "mute"}
          onClick={() => v.setMuted(!v.muted)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center transition-all active:scale-95"
        >
          {v.muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {v.state === "responding" ? (
          <button
            aria-label="interrupt"
            onClick={v.interrupt}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_24px_rgba(255,255,255,0.3)] active:scale-95 transition-transform"
          >
            <Pause size={20} />
          </button>
        ) : (
          // Realtime uses server-VAD — no end-turn button. The big silver
          // disk just shows the live state (mute/unmute is the only mic gate).
          <div
            aria-hidden="true"
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
              border: "1px solid rgba(255,255,255,0.18)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              boxShadow: v.state === "listening"
                ? "0 0 24px rgba(255,255,255,0.25)"
                : undefined,
            }}
          >
            <Mic size={20} className="text-white/85" />
          </div>
        )}
        <button
          aria-label="keyboard"
          onClick={() => onSwitchToKeyboard(v.sessionId)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center transition-all active:scale-95"
        >
          <Keyboard size={18} />
        </button>
      </div>
    </div>
  );
}
