import { useEffect, useState } from "react";
import {
  fetchSuggestedChips,
  createPinnedChip,
  deletePinnedChip,
  updatePinnedChip,
  type SuggestedChip,
} from "../api.js";

type Props = {
  /** Bumps when the chat sends or the session resets — chips refresh. */
  refreshKey: number;
  onTap: (prompt: string) => void;
};

export function QuickChips({ refreshKey, onTap }: Props) {
  const [chips, setChips] = useState<SuggestedChip[] | null>(null);
  const [editing, setEditing] = useState<SuggestedChip | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSuggestedChips()
      .then((cs) => {
        if (!cancelled) setChips(cs);
      })
      .catch(() => {
        if (!cancelled) setChips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!chips || chips.length === 0) return null;

  return (
    <div className="px-3 pb-2 flex flex-wrap gap-2">
      {chips.map((c) => (
        <Chip
          key={c.id}
          chip={c}
          onTap={() => onTap(c.prompt)}
          onLongPress={() => setEditing(c)}
        />
      ))}
      {editing ? (
        <ChipMenu
          chip={editing}
          onClose={() => setEditing(null)}
          onAfter={async () => {
            setEditing(null);
            const cs = await fetchSuggestedChips().catch(() => []);
            setChips(cs);
          }}
        />
      ) : null}
    </div>
  );
}

function Chip({
  chip,
  onTap,
  onLongPress,
}: {
  chip: SuggestedChip;
  onTap: () => void;
  onLongPress: () => void;
}) {
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const startPress = () => {
    pressTimer = setTimeout(() => {
      onLongPress();
      pressTimer = null;
    }, 500);
  };
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
      onTap();
    }
  };
  const dot = chip.source === "pinned" ? "•" : "";
  return (
    <button
      type="button"
      onMouseDown={startPress}
      onTouchStart={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={() => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      }}
      onTouchEnd={cancelPress}
      className={
        "text-sm rounded-full px-3 py-1 border " +
        (chip.source === "pinned"
          ? "border-emerald-700 bg-emerald-950 text-emerald-200"
          : "border-neutral-700 bg-neutral-900 text-neutral-300")
      }
      aria-label={chip.label}
    >
      {chip.label}
      {dot ? <span className="ml-1 text-emerald-500">{dot}</span> : null}
    </button>
  );
}

function ChipMenu({
  chip,
  onClose,
  onAfter,
}: {
  chip: SuggestedChip;
  onClose: () => void;
  onAfter: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState(chip.label);
  const [prompt, setPrompt] = useState(chip.prompt);
  const [busy, setBusy] = useState(false);

  async function pinNew() {
    setBusy(true);
    try {
      await createPinnedChip({ label, prompt });
      await onAfter();
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (chip.source !== "pinned") return pinNew();
    setBusy(true);
    try {
      await updatePinnedChip(chip.id, { label, prompt });
      await onAfter();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (chip.source !== "pinned") return;
    setBusy(true);
    try {
      await deletePinnedChip(chip.id);
      await onAfter();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="edit chip"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg p-4 w-80 max-w-[90vw] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-neutral-400">
          {chip.source === "pinned" ? "Edit pinned chip" : "Pin this chip"}
        </div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt"
          rows={3}
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
        />
        <div className="flex justify-between gap-2">
          {chip.source === "pinned" ? (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="text-red-400 text-sm px-2 py-1"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-neutral-400 text-sm px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !label.trim() || !prompt.trim()}
              onClick={save}
              className="bg-emerald-700 text-emerald-100 text-sm px-3 py-1 rounded disabled:opacity-50"
            >
              {chip.source === "pinned" ? "Save" : "Pin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
