import { useState } from "react";
import { motion } from "motion/react";
import { api } from "../api.js";
import { setToken } from "./tokens.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";

const LEN = 6;

export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const [label, setLabel] = useState(navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  function setChar(i: number, ch: string) {
    const filtered = ch.replace(/[^A-Za-z0-9]/g, "").slice(-1).toUpperCase();
    const next = chars.slice();
    next[i] = filtered;
    setChars(next);
    if (filtered && i < LEN - 1) {
      (document.getElementById(`pair-${i + 1}`) as HTMLInputElement | null)?.focus();
    }
  }

  async function submit() {
    const code = chars.join("");
    if (code.length !== LEN) {
      setError("invalid or expired code");
      setShakeKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.pair(code, label.trim() || "Phone");
      setToken(r.token);
      onPaired();
    } catch {
      setError("invalid or expired code");
      setShakeKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <PathsBackground opacity={1} />
      <div className="relative z-10 flex flex-col items-center justify-center h-full p-6 text-white">
        <h1 className="text-5xl font-bold tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
          Ava
        </h1>
        <p className="text-white/55 text-xs mb-8 text-center max-w-[260px]">
          Pair this device. Get the code from the Ava systray icon on your PC.
        </p>
        <motion.div
          key={shakeKey}
          animate={shakeKey > 0 ? { x: [0, -10, 10, -8, 0] } : { x: 0 }}
          transition={{ duration: 0.25 }}
          className="flex gap-2 mb-4"
        >
          {chars.map((c, i) => (
            <input
              key={i}
              id={`pair-${i}`}
              value={c}
              onChange={(e) => setChar(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !c && i > 0) {
                  (document.getElementById(`pair-${i - 1}`) as HTMLInputElement | null)?.focus();
                }
                if (e.key === "Enter") submit();
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, LEN);
                if (pasted.length > 1) {
                  e.preventDefault();
                  const next = Array(LEN).fill("");
                  for (let k = 0; k < pasted.length; k++) next[k] = pasted[k];
                  setChars(next);
                  const focusIdx = Math.min(pasted.length, LEN - 1);
                  (document.getElementById(`pair-${focusIdx}`) as HTMLInputElement | null)?.focus();
                }
              }}
              maxLength={1}
              inputMode="text"
              autoCapitalize="characters"
              className={
                "w-10 h-12 text-center text-lg font-mono bg-black/60 backdrop-blur-md rounded-md outline-none focus:border-white/50 transition-colors " +
                (error ? "border border-red-500" : "border border-white/15")
              }
            />
          ))}
        </motion.div>
        {error && (
          <div className="w-72 mb-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Device label"
          className="w-72 bg-black/60 backdrop-blur-md border border-white/12 rounded-md px-3 py-2 text-sm mb-3 placeholder:text-white/35"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="w-72 bg-white text-black rounded-md py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Pairing…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
