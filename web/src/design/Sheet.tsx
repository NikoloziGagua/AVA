import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";

/**
 * A focused task on top of the current screen: a sheet from the bottom on a
 * phone, a centred panel on wider screens. Escape, the close button and the
 * scrim all dismiss it; focus is trapped while it is open (Radix Dialog).
 */
export function Sheet({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ds-sheet-scrim fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          className={cn(
            "ds-root ds-sheet fixed z-50 grid max-h-[88dvh] w-full gap-5 overflow-y-auto bg-raised p-5 font-ui text-ink shadow-e3 outline-none",
            "inset-x-0 bottom-0 rounded-t-sheet",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sheet sm:p-6",
            className,
          )}
          style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div aria-hidden="true" className="mx-auto -mt-1 h-1.5 w-10 rounded-full bg-glass-strong sm:hidden" />
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <DialogPrimitive.Title className="text-heading text-ink">{title}</DialogPrimitive.Title>
              {description
                ? <DialogPrimitive.Description className="text-body text-ink-2">{description}</DialogPrimitive.Description>
                : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="quiet" size="icon" aria-label="Close"><X size={18} aria-hidden="true" /></Button>
            </DialogPrimitive.Close>
          </div>
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Asks before a risky action (the approvals flow). Says exactly what will
 * happen, and makes declining as easy as approving.
 */
export function ApprovalSheet({ open, onOpenChange, title, summary, details, risk, onApprove, onDecline, busy }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: string;
  details?: ReactNode;
  risk?: string;
  onApprove: () => void;
  onDecline: () => void;
  busy?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={summary}
      footer={(
        <>
          <Button variant="glass" onClick={onDecline} disabled={busy}>Don't do it</Button>
          <Button variant="solid" onClick={onApprove} loading={busy}>Approve</Button>
        </>
      )}
    >
      {risk && <p className="rounded-card bg-warning-soft px-4 py-3 text-body text-ink">{risk}</p>}
      {details}
    </Sheet>
  );
}
