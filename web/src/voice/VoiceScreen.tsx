import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Pulse } from "../components/ava/Pulse.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { useVoiceSession } from "./useVoiceSession.js";
import { useMicAmplitude } from "./useMicAmplitude.js";
import { Mic, Square, Keyboard, MicOff, Pause, X } from "lucide-react";

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
  const v = useVoiceSession({ initialSessionId });
  const [muted, setMuted] = useState(false);
  const amp = useMicAmplitude(v.state === "listening" && !muted);
  const [secs, setSecs] = useState(0);

  useEffect(() => { v.startListening(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (v.state !== "listening") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [v.state]);
  useEffect(() => { if (v.state === "idle") setSecs(0); }, [v.state]);

  const stateLabel =
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
        <Pulse layoutId="ava-pulse" state={v.state === "idle" ? "idle" : v.state} size={120} amplitude={amp} />
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

      {v.errorMsg && (
        <div className="absolute left-1/2 -translate-x-1/2 top-20 w-72">
          <Alert variant="destructive" close onClose={() => onExit(v.sessionId)}>
            <AlertDescription>{v.errorMsg}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="absolute left-0 right-0 bottom-8 flex items-center justify-center gap-5">
        <button
          aria-label={muted ? "unmute" : "mute"}
          onClick={() => setMuted((m) => !m)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center"
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {v.state === "listening" && (
          <button
            aria-label="end turn"
            onClick={v.stopListening}
            className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.5)]"
          >
            <Square size={20} />
          </button>
        )}
        {v.state === "responding" && (
          <button
            aria-label="interrupt"
            onClick={v.stopResponding}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_24px_rgba(255,255,255,0.3)]"
          >
            <Pause size={20} />
          </button>
        )}
        {v.state !== "listening" && v.state !== "responding" && (
          <button
            aria-label="start listening"
            onClick={v.startListening}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center"
          >
            <Mic size={20} />
          </button>
        )}
        <button
          aria-label="keyboard"
          onClick={() => onSwitchToKeyboard(v.sessionId)}
          className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center"
        >
          <Keyboard size={18} />
        </button>
      </div>
    </div>
  );
}
