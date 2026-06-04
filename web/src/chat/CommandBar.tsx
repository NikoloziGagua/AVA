import { useState, type FormEvent } from "react";

export interface CommandBarProps {
  /** Called with the trimmed text on submit (Enter or the send button). */
  onSubmit: (text: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Home omnibox — type to start a chat or tell Ava to do something. Submitting
 * hands the text up; the home wires it to open a new chat seeded with the text.
 */
export function CommandBar({ onSubmit, placeholder = "Ask Ava, or tell her to do something…", className }: CommandBarProps) {
  const [text, setText] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText("");
  }

  return (
    <form onSubmit={submit} className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 ${className ?? ""}`}>
      <span aria-hidden="true" style={{ color: "var(--ac)", fontSize: 15 }}>⌕</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
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
