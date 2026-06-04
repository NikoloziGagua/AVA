import { useState, type ReactNode } from "react";
import { RefreshCcw, Copy, ThumbsUp, ThumbsDown, Share2, Check } from "lucide-react";
import { NO_REACTION, toggleLike, toggleDislike } from "./message-actions.js";

export interface MessageActionsProps {
  /** The message text — copied / shared. */
  text: string;
  /** Re-run the turn that produced this reply. Hidden if omitted. */
  onRetry?: () => void;
}

function ActBtn({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg border text-white/55 transition-colors hover:text-[var(--ac)]"
      style={{
        borderColor: active ? "rgba(92,242,255,0.35)" : "rgba(255,255,255,0.08)",
        background: active ? "rgba(92,242,255,0.08)" : "rgba(255,255,255,0.03)",
        color: active ? "var(--ac)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

/** Action row under an Ava reply: Retry / Copy / Like / Dislike / Share. */
export function MessageActions({ text, onRetry }: MessageActionsProps) {
  const [reaction, setReaction] = useState(NO_REACTION);
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }
  function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      void (navigator as Navigator & { share: (d: { text: string }) => Promise<void> }).share({ text }).catch(() => {});
    } else {
      copy();
    }
  }

  return (
    <div className="flex gap-1">
      {onRetry && (
        <ActBtn label="Retry" onClick={onRetry}>
          <RefreshCcw size={13} />
        </ActBtn>
      )}
      <ActBtn label="Copy" onClick={copy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </ActBtn>
      <ActBtn label="Like" active={reaction.liked} onClick={() => setReaction(toggleLike)}>
        <ThumbsUp size={13} />
      </ActBtn>
      <ActBtn label="Dislike" active={reaction.disliked} onClick={() => setReaction(toggleDislike)}>
        <ThumbsDown size={13} />
      </ActBtn>
      <ActBtn label="Share" onClick={share}>
        <Share2 size={13} />
      </ActBtn>
    </div>
  );
}
