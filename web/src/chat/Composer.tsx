import { useEffect, useRef, useState } from "react";
import { fetchSuggestedChips, type SuggestedChip } from "../api.js";
import { Textarea } from "../components/ui/textarea.js";
import { Orb } from "../components/ava/Orb.js";
import { ArrowUp, Square } from "lucide-react";

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

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "48px";
  }

  return (
    <div className="sticky bottom-0 px-3 pb-3 pt-2 bg-gradient-to-t from-black via-black/85 to-transparent">
      {chips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-1">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setText(c.prompt)}
              title={c.prompt}
              className="group relative shrink-0 px-3.5 py-2 rounded-full text-xs text-white/70 hover:text-white transition-colors overflow-hidden"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(14px) saturate(140%)",
                WebkitBackdropFilter: "blur(14px) saturate(140%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
              }}
            >
              <span className="relative z-10">{c.label}</span>
              {/* Hover gradient sheen */}
              <span
                aria-hidden="true"
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.18))",
                }}
              />
              {/* Hover bottom underline */}
              <span
                aria-hidden="true"
                className="absolute left-3 right-3 bottom-0 h-px scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(248,250,252,0.7), transparent)",
                }}
              />
            </button>
          ))}
        </div>
      )}
      <div
        className="relative rounded-2xl flex items-end gap-2 p-2 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 40px -12px rgba(0,0,0,0.7)",
        }}
      >
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
          placeholder="Message Ava…"
          className="resize-none min-h-[48px] max-h-[150px] border-none bg-transparent focus-visible:ring-0 text-white/90 placeholder:text-white/30"
        />
        <button
          aria-label="voice"
          onClick={onMicTap}
          title="Voice mode"
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90"
        >
          <Orb state="idle" size={28} />
        </button>
        {busy ? (
          <button
            aria-label="stop"
            onClick={onKill}
            className="shrink-0 w-10 h-10 rounded-xl bg-red-500/90 hover:bg-red-500 text-white flex items-center justify-center transition-all active:scale-95 shadow-[0_0_18px_rgba(239,68,68,0.5)]"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            aria-label="send"
            onClick={submit}
            disabled={!text.trim()}
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: text.trim()
                ? "linear-gradient(135deg, #ffffff, #e2e8f0)"
                : "rgba(255,255,255,0.06)",
              color: text.trim() ? "#0a0a0b" : "rgba(255,255,255,0.4)",
              boxShadow: text.trim()
                ? "0 0 20px rgba(255,255,255,0.25), inset 0 1px 0 rgba(255,255,255,0.5)"
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
