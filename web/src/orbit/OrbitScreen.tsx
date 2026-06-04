import { useEffect } from "react";
import { Plus, List, Brain, Settings2, Sparkles } from "lucide-react";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { NebulaBackground } from "../components/ava/NebulaBackground.js";
import { TubelightNav, type TubelightItem } from "../components/ava/TubelightNav.js";
import { Orb } from "../components/ava/Orb.js";
import { CommandBar } from "../chat/CommandBar.js";

export interface OrbitScreenProps {
  onOpenChat: (sessionId: string | null) => void;
  /** Submit from the command bar → open a new chat seeded with this text. */
  onCommand: (text: string) => void;
  onOpenMemory: () => void;
  onOpenRules: () => void;
  onOpenList: () => void;
  onOpenSelf: () => void;
  onEnterVoice: () => void;
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/**
 * Home — de-spun. No orbital ring, no rotating chat nodes. The moving
 * DottedSurface + Nebula behind a glass tubelight nav, the mercury Orb hero, the
 * AVA wordmark, and a command bar. Press Space (or click the orb) to talk.
 */
export function OrbitScreen({
  onOpenChat, onCommand, onOpenMemory, onOpenRules, onOpenList, onOpenSelf, onEnterVoice,
}: OrbitScreenProps) {
  // Space anywhere (when not typing) → voice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTypingTarget(e)) {
        e.preventDefault();
        onEnterVoice();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnterVoice]);

  const items: TubelightItem[] = [
    { name: "New", icon: Plus, onSelect: () => onOpenChat(null) },
    { name: "Chats", icon: List, onSelect: onOpenList },
    { name: "Memory", icon: Brain, onSelect: onOpenMemory },
    { name: "Rules", icon: Settings2, onSelect: onOpenRules },
    { name: "Self", icon: Sparkles, onSelect: onOpenSelf },
  ];

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <DottedSurface />
      <NebulaBackground />
      {/* vignette to lift the orb */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 46%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2">
        <TubelightNav items={items} activeName="New" />
      </div>

      <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <div className="hud mb-4 text-[10px] text-white/40">I AM</div>
        <button onClick={onEnterVoice} aria-label="hold to speak" className="cursor-pointer">
          <Orb size={150} state="idle" flipId="ava-orb" />
        </button>
        <div
          className="mt-5 bg-clip-text text-5xl font-semibold tracking-[0.34em] text-transparent"
          style={{ backgroundImage: "linear-gradient(180deg,#fff,rgba(255,255,255,.5))" }}
        >
          AVA
        </div>
        <div className="hud mt-3 text-[10px] text-white/45">
          HOLD <span style={{ color: "var(--ac)" }}>SPACE</span> TO SPEAK · OR TYPE
        </div>
      </div>

      <div className="absolute bottom-12 left-1/2 z-20 w-[460px] max-w-[80%] -translate-x-1/2">
        <CommandBar onSubmit={onCommand} />
      </div>
    </div>
  );
}
