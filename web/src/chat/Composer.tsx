import { useEffect, useRef, useState, type CSSProperties } from "react";
import { insertDictation as insertDictationText } from "../design/dictation.js";
import { fetchSuggestedChips, transcribeAudio, type SuggestedChip } from "../api.js";
import { useDictation } from "../design/dictation.js";
import { isCoarsePointer } from "../lib/media.js";
import { gsap, useGSAP } from "../lib/gsap.js";
import { D, EASE, SHADOW, press } from "../lib/deckMotion.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { Textarea } from "../components/ui/textarea.js";
import { Orb } from "../components/ava/Orb.js";
import { ArrowUp, LoaderCircle, Mic, Square, X } from "lucide-react";

export interface ComposerProps {
  onSend: (text: string) => void;
  onKill: () => void;
  onMicTap: () => void;
  busy: boolean;
  seed: { text: string; version: number };
}

const REST_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 40px -12px rgba(0,0,0,0.7)";

export {
  describeDictationError,
  insertDictation,
  normalizedAudioMime,
  preferredDictationMime,
  type DictationState,
} from "../design/dictation.js";

export function Composer({ onSend, onKill, onMicTap, busy, seed }: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<SuggestedChip[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation({
    transcribe: transcribeAudio,
    onText: (transcript) => {
      setText((current) => insertDictationText(current, transcript));
      requestAnimationFrame(() => taRef.current?.focus());
    },
  });
  const dictationState = dictation.state;
  const dictationError = dictation.error;
  const cancelDictation = dictation.cancel;
  const beginDictation = dictation.begin;
  const finishDictation = dictation.finish;
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP({ scope: boxRef });

  useEffect(() => {
    fetchSuggestedChips().then(setChips).catch(() => {});
  }, []);

  // Desktop autofocus: when the chat opens, put the caret straight in the
  // composer — there's a hardware keyboard, so Sir can just start typing.
  // Coarse pointers (phones) skip this: autofocus would pop the soft keyboard
  // over the conversation uninvited.
  useEffect(() => {
    if (!isCoarsePointer()) taRef.current?.focus();
  }, []);

  useEffect(() => {
    if (seed.version > 0) {
      setText(seed.text);
      taRef.current?.focus();
    }
  }, [seed.version, seed.text]);

  // Text-driven auto-grow (48 → 150px). Composes with the focus-driven minHeight
  // floor below: focus sets the floor, text grows the ceiling above it.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "48px";
    const next = Math.min(ta.scrollHeight, 150);
    ta.style.height = `${next}px`;
  }, [text]);

  // ── Focus: expand the container (fast / eager) ──
  const onFocus = contextSafe(() => {
    if (reduced) {
      if (taRef.current) gsap.set(taRef.current, { minHeight: 64 });
      return;
    }
    gsap.to(boxRef.current, {
      scale: 1.012,
      boxShadow: SHADOW.hover + ", 0 0 28px -6px rgba(92,242,255,.22)",
      borderColor: "rgba(92,242,255,.28)",
      duration: D.fast,
      ease: EASE,
      transformOrigin: "50% 100%",
    });
    gsap.to(taRef.current, { minHeight: 64, duration: D.fast, ease: EASE });
    // One specular glint across the box on focus (reads --sweep-x via .lg-sweep).
    gsap.fromTo(boxRef.current, { "--sweep-x": "-130%" }, { "--sweep-x": "130%", duration: 0.7, ease: "power2.inOut" });
  });

  // ── Blur: collapse back (slower / settling) — only when empty (keep a draft) ──
  const onBlur = contextSafe(() => {
    if (text.trim() !== "") return;
    if (reduced) {
      if (taRef.current) gsap.set(taRef.current, { minHeight: 48 });
      return;
    }
    gsap.to(boxRef.current, {
      scale: 1,
      boxShadow: REST_SHADOW,
      borderColor: "rgba(255,255,255,.08)",
      duration: D.screen,
      ease: "power3.out",
    });
    gsap.to(taRef.current, { minHeight: 48, duration: D.screen, ease: "power3.out" });
  });

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "48px";
    // Keep the caret in the box after a mouse-click send (Enter-sends already
    // keeps focus; clicking the arrow button steals it). Desktop only — on
    // phones refocusing would pin the soft keyboard open.
    if (!isCoarsePointer()) taRef.current?.focus();
  }

  const pressHandlers = {
    onPointerDown: contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, true, reduced)),
    onPointerUp: contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, false, reduced)),
    onPointerLeave: contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, false, reduced)),
  };

  return (
    <div
      className="sticky bottom-0 px-3 pt-2 bg-gradient-to-t from-black via-black/85 to-transparent"
      // Keep the composer clear of the home-indicator area on notched phones
      // (env() is 0 on desktop, so this stays the old pb-3 there).
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      {/* lg: match the widened desktop reading column so the composer lines up
          with the messages instead of sitting narrower than them. */}
      <div className="mx-auto w-full max-w-[760px] lg:max-w-[860px]">
        {chips.length > 0 && (
          <div className="relative -mx-1 mb-1">
            <div className="flex gap-2 overflow-x-auto pb-2 px-1">
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
                {/* Hover gradient sheen — cyan family */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: "rgba(92,242,255,0.16)" }}
                />
                {/* Hover bottom underline — cyan edge-light */}
                <span
                  aria-hidden="true"
                  className="absolute left-3 right-3 bottom-0 h-px scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(92,242,255,0.7), transparent)",
                  }}
                />
              </button>
            ))}
            </div>
            {/* Right-edge fade: signals "scroll for more" so the last chip reads
                as clipped-by-design, not truncated mid-word. Over the near-black
                composer backdrop this is invisible when nothing overflows. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-10"
              style={{ background: "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.92))" }}
            />
          </div>
        )}
        <div
          ref={boxRef}
          className="lg-sweep relative rounded-2xl flex items-end gap-2 p-2"
          style={{
            "--sweep-x": "-130%",
            background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            boxShadow: REST_SHADOW,
          } as CSSProperties}
        >
          <Textarea
            ref={taRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
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
            type="button"
            aria-label={dictationState === "listening" ? "stop dictation" : dictationState === "error" ? "retry dictation" : "dictate message"}
            aria-pressed={dictationState === "listening"}
            onClick={dictationState === "listening" ? finishDictation : () => { void beginDictation(); }}
            disabled={dictationState === "requesting" || dictationState === "transcribing"}
            title={dictationState === "listening" ? "Stop and transcribe" : "Dictate into this draft"}
            {...pressHandlers}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-wait"
            style={dictationState === "listening"
              ? { borderColor: "rgba(92,242,255,.65)", background: "rgba(92,242,255,.18)", color: "var(--ac)", boxShadow: "0 0 20px rgba(92,242,255,.2)" }
              : { borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.72)" }}
          >
            {dictationState === "requesting" || dictationState === "transcribing"
              ? <LoaderCircle size={17} className="animate-spin" />
              : dictationState === "listening" ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}
            {dictationState === "listening" && (
              <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
            )}
          </button>
          {(dictationState === "requesting" || dictationState === "listening" || dictationState === "transcribing") && (
            <button
              type="button"
              aria-label="cancel dictation"
              onClick={cancelDictation}
              title="Cancel dictation"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <X size={14} />
            </button>
          )}
          <button
            aria-label="voice"
            onClick={onMicTap}
            title="Voice mode"
            {...pressHandlers}
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
          >
            <Orb state="idle" size={28} />
          </button>
          {busy ? (
            <button
              aria-label="stop"
              onClick={onKill}
              {...pressHandlers}
              className="btn-danger shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              aria-label="send"
              onClick={submit}
              disabled={!text.trim()}
              {...pressHandlers}
              className="btn-primary shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:cursor-not-allowed"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <div className="min-h-6 px-2 pt-1.5 text-[11px]" aria-live="polite">
          {dictationState === "requesting" && <span className="text-white/45">Requesting microphone access…</span>}
          {dictationState === "listening" && <span className="text-cyan-200/75">Listening — tap stop when you are done. Nothing will send automatically.</span>}
          {dictationState === "transcribing" && <span className="text-white/55">Transcribing into your editable draft…</span>}
          {dictationState === "error" && dictationError && <span role="alert" className="text-rose-300/80">{dictationError}</span>}
        </div>
      </div>
    </div>
  );
}
