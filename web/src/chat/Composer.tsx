import { useEffect, useRef, useState } from "react";
import { fetchSuggestedChips, type SuggestedChip } from "../api.js";
import { Textarea } from "../components/ui/textarea.js";
import { Pulse } from "../components/ava/Pulse.js";
import { ArrowUp, Square } from "lucide-react";
import { gsap, shouldReduceMotion, useGSAP } from "../lib/gsap.js";

export interface ComposerProps {
  onSend: (text: string) => void;
  onKill: () => void;
  onMicTap: () => void;
  busy: boolean;
  seed: { text: string; version: number };
}

export function Composer({ onSend, onKill, onMicTap, busy, seed }: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<SuggestedChip[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSuggestedChips().then(setChips).catch(() => {});
  }, []);

  useEffect(() => {
    if (seed.version > 0) {
      setText(seed.text);
      taRef.current?.focus();
    }
  }, [seed.version, seed.text]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "48px";
    const next = Math.min(ta.scrollHeight, 150);
    ta.style.height = `${next}px`;
  }, [text]);

  useGSAP(() => {
    if (!scope.current || shouldReduceMotion()) return;
    gsap.fromTo(
      ".composer-reveal",
      { autoAlpha: 0, y: 10, filter: "blur(8px)" },
      { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.46, stagger: 0.035, ease: "power2.out" },
    );
  }, { scope, dependencies: [chips.length] });

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "48px";
  }

  return (
    <div ref={scope} className="sticky bottom-0 z-20 px-3 pb-3 pt-2 bg-gradient-to-t from-black via-black/90 to-transparent">
      {chips.length > 0 && (
        <div className="-mx-1 mb-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setText(c.prompt)}
              title={c.prompt}
              className="composer-reveal ava-chip group relative shrink-0 overflow-hidden px-3.5 py-2 text-xs"
            >
              <span className="relative z-10">{c.label}</span>
              <span
                aria-hidden="true"
                className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(216,189,131,0.16), rgba(93,124,255,0.12))",
                }}
              />
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-3 right-3 h-px origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(216,189,131,0.78), transparent)",
                }}
              />
            </button>
          ))}
        </div>
      )}
      <div className="composer-reveal ava-composer-shell relative flex items-end gap-2 overflow-hidden rounded-[8px] p-2">
        <Textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message Ava..."
          className="min-h-[48px] max-h-[150px] resize-none border-none bg-transparent text-[var(--ava-ink)] placeholder:text-[var(--ava-fg-faint)] focus-visible:ring-0"
        />
        <button
          aria-label="voice"
          onClick={onMicTap}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
        >
          <Pulse state="idle" size={28} />
        </button>
        {busy ? (
          <button
            aria-label="stop"
            onClick={onKill}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-red-500/90 text-white shadow-[0_0_18px_rgba(239,68,68,0.5)] transition-all hover:bg-red-500 active:scale-95"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            aria-label="send"
            onClick={submit}
            disabled={!text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: text.trim()
                ? "linear-gradient(135deg, #fffaf0, #d8bd83)"
                : "rgba(247,239,226,0.06)",
              color: text.trim() ? "#0a0a0b" : "rgba(247,239,226,0.42)",
              boxShadow: text.trim()
                ? "0 0 20px rgba(216,189,131,0.26), inset 0 1px 0 rgba(255,255,255,0.5)"
                : undefined,
            }}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
