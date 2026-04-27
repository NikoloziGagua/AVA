// web/src/auth/PairingScreen.tsx
import { useState } from "react";
import { api } from "../api.js";
import { setToken } from "./tokens.js";

export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.pair(code.trim().toUpperCase(), label.trim());
      setToken(r.token);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <h1 className="text-2xl font-semibold mb-2">Ava</h1>
      <p className="text-neutral-400 text-sm mb-6">
        Pair this device. Get the code from the Ava systray icon on your PC.
      </p>
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <input
          inputMode="text"
          autoCapitalize="characters"
          placeholder="Pairing code"
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 tracking-widest font-mono uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          required
        />
        <input
          placeholder="Device label (e.g. iPhone)"
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 rounded py-2 font-medium"
        >
          {busy ? "Pairing…" : "Pair device"}
        </button>
      </form>
    </div>
  );
}
