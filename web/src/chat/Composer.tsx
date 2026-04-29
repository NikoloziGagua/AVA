import { useEffect, useState } from "react";

export function Composer({
  onSend,
  onKill,
  busy,
  /** Seeds the input when this prop's identity changes (e.g. chip tap). */
  seed,
}: {
  onSend: (text: string) => void;
  onKill: () => void;
  busy: boolean;
  seed?: { text: string; version: number };
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (seed) setText(seed.text);
  }, [seed?.version]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSend(text);
        setText("");
      }}
      className="border-t border-neutral-800 p-3 flex gap-2"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Talk to Ava…"
        className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
      />
      {busy ? (
        <button
          type="button"
          onClick={onKill}
          className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded font-medium"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-emerald-600 disabled:bg-neutral-700 px-4 py-2 rounded font-medium"
        >
          Send
        </button>
      )}
    </form>
  );
}
