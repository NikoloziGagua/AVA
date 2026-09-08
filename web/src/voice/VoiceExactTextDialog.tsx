import { useEffect, useRef, useState, type RefObject } from "react";
import { CornerDownLeft, Type } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog.js";

export interface VoiceExactTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (text: string) => Promise<boolean>;
  sessionReady: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A deliberately boring text boundary inside the cinematic voice surface.
 * Text remains byte-for-byte what the owner entered; trim is used only to
 * reject an empty turn. Plain Enter inserts a newline. Only the button or the
 * documented Ctrl/Cmd+Enter gesture submits.
 */
export function VoiceExactTextDialog({
  open,
  onOpenChange,
  onSubmit,
  sessionReady,
  returnFocusRef,
}: VoiceExactTextDialogProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setSubmitting(false);
      submittingRef.current = false;
      setError(null);
    }
  }, [open]);

  const canSubmit = sessionReady && !submitting && draft.trim().length > 0;
  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await onSubmit(draft);
      if (accepted) onOpenChange(false);
      else setError("AVA could not accept that turn. Your exact text is still here.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AVA could not accept that turn.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
        className="w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden rounded-3xl border-cyan-200/20 bg-[#05080c]/95 p-0 shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
      >
        <div className="border-b border-white/10 px-5 pb-4 pt-5 sm:px-6">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-300/[0.08] text-cyan-100">
            <Type size={17} aria-hidden="true" />
          </div>
          <DialogTitle className="text-lg font-medium text-white">Type exact text</DialogTitle>
          <DialogDescription className="mt-1.5 max-w-md text-sm leading-6 text-white/55">
            Use this for names, usernames, URLs, code, quoted wording, or a precise correction. Nothing sends until you submit.
          </DialogDescription>
        </div>

        <div className="space-y-3 px-5 py-5 sm:px-6">
          <label htmlFor="voice-exact-text" className="hud block text-[9px] text-white/45">
            Exact wording
          </label>
          <textarea
            id="voice-exact-text"
            autoFocus
            value={draft}
            maxLength={10_000}
            rows={6}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="For example: Open @exact_username — keep the underscore."
            className="soft-scrollbar w-full resize-y rounded-2xl border border-white/12 bg-black/40 px-4 py-3 font-mono text-[15px] leading-6 text-white outline-none transition-colors placeholder:text-white/25 focus:border-cyan-200/45"
            aria-describedby="voice-exact-help voice-exact-status"
          />
          <div className="flex items-start justify-between gap-4 text-[11px] text-white/35">
            <p id="voice-exact-help">Enter makes a new line · Ctrl/⌘ + Enter submits</p>
            <span aria-label={`${draft.length} of 10000 characters`}>{draft.length.toLocaleString()} / 10,000</span>
          </div>

          <div id="voice-exact-status" aria-live="polite" className="min-h-5 text-xs">
            {!sessionReady && <span className="text-amber-200/75">Waiting for the shared voice session…</span>}
            {sessionReady && !error && <span className="text-cyan-100/55">Microphone paused while you type.</span>}
            {error && <span role="alert" className="text-red-300">{error}</span>}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 bg-white/[0.025] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="rounded-full border border-white/12 px-4 py-2.5 text-sm text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 rounded-full bg-[var(--ac)] px-5 py-2.5 text-sm font-medium text-[#04222a] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <CornerDownLeft size={15} aria-hidden="true" />
            {submitting ? "Sending…" : "Send to AVA"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
