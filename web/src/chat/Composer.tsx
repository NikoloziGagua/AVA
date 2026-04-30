import { useEffect, useRef, useState } from "react";
import { fetchSuggestedChips, type SuggestedChip } from "../api.js";
import { Textarea } from "../components/ui/textarea.js";
import { Pulse } from "../components/ava/Pulse.js";
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
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setText(c.prompt)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
              title={c.prompt}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md flex items-end gap-2 p-2">
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
          className="resize-none min-h-[48px] max-h-[150px] border-none bg-transparent focus-visible:ring-0"
        />
        <button
          aria-label="voice"
          onClick={onMicTap}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        >
          <Pulse state="idle" size={28} />
        </button>
        {busy ? (
          <button aria-label="stop" onClick={onKill} className="shrink-0 w-9 h-9 rounded-md bg-red-500/90 text-white flex items-center justify-center">
            <Square size={14} />
          </button>
        ) : (
          <button aria-label="send" onClick={submit} className="shrink-0 w-9 h-9 rounded-md bg-white text-black flex items-center justify-center disabled:opacity-50" disabled={!text.trim()}>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
