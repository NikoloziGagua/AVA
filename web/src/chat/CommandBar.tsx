import { useRef, useState, type FormEvent } from "react";
import { gsap, useGSAP } from "../lib/gsap.js";
import { D, EASE } from "../lib/deckMotion.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";

export interface CommandBarProps {
  /** Called with the trimmed text on submit (Enter or the send button). */
  onSubmit: (text: string) => void;
  /** Focus handoff so the host can expand the bar's stage (home widens the rail). */
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  className?: string;
}

const REST_SHADOW = "inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 36px -14px rgba(0,0,0,0.7)";

/**
 * Home omnibox — type to start a chat or tell Ava to do something. Submitting
 * hands the text up; the home wires it to open a new chat seeded with the text.
 *
 * Focus IGNITES the bar with the same motion language as the chat Composer:
 * a cyan edge, a soft glow, one specular glint — and reports focus up so the
 * home can widen the rail underneath it. Blur settles back (keeping a draft lit).
 */
export function CommandBar({ onSubmit, onFocusChange, placeholder = "Ask Ava, or tell her to do something…", className }: CommandBarProps) {
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP({ scope: formRef });

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText("");
  }

  const onFocus = contextSafe(() => {
    onFocusChange?.(true);
    if (reduced) return;
    gsap.to(formRef.current, {
      borderColor: "rgba(92,242,255,.32)",
      boxShadow: REST_SHADOW + ", 0 0 30px -8px rgba(92,242,255,.3)",
      duration: D.fast,
      ease: EASE,
    });
    // One specular glint across the bar on focus (reads --sweep-x via .lg-sweep).
    gsap.fromTo(formRef.current, { "--sweep-x": "-130%" }, { "--sweep-x": "130%", duration: 0.7, ease: "power2.inOut" });
  });

  const onBlur = contextSafe(() => {
    onFocusChange?.(false);
    if (reduced || text.trim() !== "") return; // keep a draft visibly lit
    gsap.to(formRef.current, {
      borderColor: "rgba(255,255,255,.1)",
      boxShadow: REST_SHADOW,
      duration: D.screen,
      ease: EASE,
    });
  });

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className={`glass lg-sweep flex items-center gap-3 rounded-2xl px-4 py-3 ${className ?? ""}`}
      style={{ "--sweep-x": "-130%", boxShadow: REST_SHADOW } as React.CSSProperties}
    >
      <span aria-hidden="true" style={{ color: "var(--ac)", fontSize: 15 }}>⌕</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-label="command"
        className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/40"
      />
      <button
        type="submit"
        aria-label="send"
        className="flex h-8 w-8 items-center justify-center rounded-xl text-[15px] active:scale-95 transition-transform"
        style={{ background: "var(--ac)", color: "#04222a" }}
      >
        ↑
      </button>
    </form>
  );
}
