import { useEffect, useRef, useState, type RefObject } from "react";
import { CornerDownLeft, Type } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Button } from "../design/Button.js";

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
        className="ds-root w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden rounded-sheet border-0 bg-raised p-0 font-ui text-ink shadow-e3"
      >
        <div className="px-5 pt-6 sm:px-6">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-glass text-ink">
            <Type size={18} aria-hidden="true" />
          </div>
          <DialogTitle className="text-heading text-ink">Type exact text</DialogTitle>
          <DialogDescription className="mt-1.5 max-w-md text-body text-ink-2">
            Use this for names, usernames, URLs, code, quoted wording, or a precise correction. Nothing sends until you submit.
          </DialogDescription>
        </div>

        <div className="grid gap-3 px-5 py-5 sm:px-6">
          <label htmlFor="voice-exact-text" className="font-ui-mono text-label uppercase text-ink-3">
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
            className="ds-focus w-full resize-y rounded-card bg-glass px-4 py-3 font-ui-mono text-body text-ink outline-none transition-colors placeholder:text-ink-3 hover:bg-glass-strong"
            aria-describedby="voice-exact-help voice-exact-status"
          />
          <div className="flex items-start justify-between gap-4 text-meta text-ink-3">
            <p id="voice-exact-help">Enter makes a new line · Ctrl/⌘ + Enter submits</p>
            <span aria-label={`${draft.length} of 10000 characters`}>{draft.length.toLocaleString()} / 10,000</span>
          </div>

          <div id="voice-exact-status" aria-live="polite" className="min-h-5 text-meta">
            {!sessionReady && <span className="text-warning">Waiting for the shared voice session…</span>}
            {sessionReady && !error && <span className="text-ink-2">Microphone paused while you type.</span>}
            {error && <span role="alert" className="text-danger">{error}</span>}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 px-5 pb-5 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <Button variant="glass" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="solid" onClick={() => void submit()} disabled={!canSubmit} leading={<CornerDownLeft size={16} aria-hidden="true" />}>
            {submitting ? "Sending…" : "Send to AVA"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
