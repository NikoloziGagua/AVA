import { useState, type ReactNode } from "react";
import { RefreshCcw, Copy, ThumbsUp, ThumbsDown, Share2, Check } from "lucide-react";
import { cn } from "../design/cn.js";
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
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      onClick={onClick}
      className={cn(
        "ds-focus grid h-9 w-9 place-items-center rounded-full transition-colors duration-150",
        active ? "bg-glass-strong text-ink" : "text-ink-3 hover:bg-glass hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Action row under an AVA reply: Retry / Copy / Like / Dislike / Share. */
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
    // Quiet at rest on a desktop and clear on hover or keyboard focus; always
    // visible on touch, where there is no hover.
    <div className="-ml-2 flex gap-0.5 transition-opacity duration-200 lg:opacity-60 lg:group-hover/msg:opacity-100 lg:focus-within:opacity-100">
      {onRetry && (
        <ActBtn label="Retry" onClick={onRetry}>
          <RefreshCcw size={15} aria-hidden="true" />
        </ActBtn>
      )}
      <ActBtn label="Copy" onClick={copy}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </ActBtn>
      <ActBtn label="Like" active={reaction.liked} onClick={() => setReaction(toggleLike)}>
        <ThumbsUp size={15} aria-hidden="true" />
      </ActBtn>
      <ActBtn label="Dislike" active={reaction.disliked} onClick={() => setReaction(toggleDislike)}>
        <ThumbsDown size={15} aria-hidden="true" />
      </ActBtn>
      <ActBtn label="Share" onClick={share}>
        <Share2 size={15} aria-hidden="true" />
      </ActBtn>
    </div>
  );
}
