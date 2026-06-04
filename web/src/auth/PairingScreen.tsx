import { useState } from "react";
import { motion } from "motion/react";
import { api } from "../api.js";
import { setToken } from "./tokens.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";
import { useGsapReveal } from "../lib/useGsapReveal.js";

const LEN = 6;

export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const [label, setLabel] = useState(navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const shellRef = useGsapReveal([error, busy]);

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
    <div ref={shellRef} className="ava-luxe-screen">
      <div className="absolute inset-0 opacity-35">
        <PathsBackground opacity={1} />
      </div>
      <div className="relative z-10 flex h-full flex-col items-center justify-center p-6 text-white">
        <div data-gsap-reveal className="mb-8 text-center">
          <div className="ava-kicker mb-3">secure pairing</div>
          <h1 className="ava-metal-wordmark text-6xl font-semibold tracking-[0.16em]">AVA</h1>
          <p className="mx-auto mt-5 max-w-[280px] text-xs leading-6 text-[var(--ava-fg-muted)]">
            Pair this device with the code from Ava on your PC.
          </p>
        </div>
        <motion.div
          key={shakeKey}
          animate={shakeKey > 0 ? { x: [0, -10, 10, -8, 0] } : { x: 0 }}
          transition={{ duration: 0.25 }}
          className="mb-4 flex gap-2"
          data-gsap-reveal
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
                "ava-luxe-field h-12 w-10 text-center font-mono text-lg " +
                (error ? "border-red-500" : "")
              }
            />
          ))}
        </motion.div>
        {error && (
          <div className="mb-3 w-72">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
        <input
          data-gsap-reveal
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Device label"
          className="ava-luxe-field mb-3 w-72 px-3 py-2 text-sm"
        />
        <button
          data-gsap-reveal
          onClick={submit}
          disabled={busy}
          className="ava-primary-button w-72 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Pairing..." : "Submit"}
        </button>
      </div>
    </div>
  );
}
