import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Mic, X } from "lucide-react";
import { cn } from "./cn.js";

export type Destination = {
  id: string;
  label: string;
  icon: ReactNode;
  group: "primary" | "system";
  /** Optional short state, e.g. "3 due". */
  meta?: string;
};

export type RecentConversation = { id: string; title: string; meta?: string };

export type BottomBarProps = {
  destinations: readonly Destination[];
  current: string | null;
  onNavigate: (id: string) => void;
  /** Human conversations only, newest first; at most 5 are shown. */
  recents?: readonly RecentConversation[];
  onOpenRecent?: (id: string) => void;
  onOpenAllConversations?: () => void;
  /** The draft is owned by the caller so it survives menu changes and navigation. */
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onTalk?: () => void;
  /** True while a send is in flight; blocks a second send. */
  sending?: boolean;
  placeholder?: string;
  /** The mini face: a static image, never a second WebGL canvas. */
  face?: ReactNode;
  /**
   * On screens that have their own message box (Talk, Voice) the bar shrinks to
   * the round menu button in the top-left corner. It is the same mounted
   * component, and its hidden input keeps the draft.
   */
  compact?: boolean;
};

/**
 * The only navigation in AVA (contract ui-remodel v2 §4): a conversation bar at
 * the bottom that grows into the menu. The input stays mounted while the menu is
 * open, so a draft is never lost. Ctrl/Cmd+K toggles the menu, Esc closes it,
 * arrow keys move between its items.
 */
export function BottomBar({
  destinations, current, onNavigate, recents = [], onOpenRecent, onOpenAllConversations,
  draft, onDraftChange, onSend, onTalk, sending = false, placeholder = "Ask AVA anything…", face, compact = false,
}: BottomBarProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const orbRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) orbRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>("[data-menu-item]");
    first?.focus({ preventScroll: true });
    // A press anywhere outside the bar and menu closes it, without stealing that press's focus.
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const go = (run: () => void) => { run(); close(false); };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || !items.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || compact) return;
    onSend(text);
  };

  const primary = destinations.filter((d) => d.group === "primary");
  const system = destinations.filter((d) => d.group === "system");
  const shownRecents = recents.slice(0, 5);
  const canSend = Boolean(draft.trim()) && !sending;

  const item = (d: Destination) => (
    <button
      key={d.id}
      type="button"
      data-menu-item=""
      aria-current={d.id === current ? "page" : undefined}
      onClick={() => go(() => onNavigate(d.id))}
      className={cn(
        "ds-focus flex h-12 items-center gap-3 rounded-button px-3 text-left text-body transition-colors duration-150",
        d.id === current ? "bg-glass-strong text-ink" : "text-ink hover:bg-glass",
      )}
    >
      <span aria-hidden="true" className="text-ink-2">{d.icon}</span>
      <span className="min-w-0 flex-1 truncate">{d.label}</span>
      {d.meta && <span className="text-meta text-ink-3">{d.meta}</span>}
    </button>
  );

  return (
    <nav
      ref={navRef}
      aria-label="AVA"
      data-compact={compact || undefined}
      className={cn(
        "ds-root pointer-events-none fixed z-40 font-ui",
        compact ? "w-[min(420px,calc(100%-1.5rem))]" : "left-1/2 w-[calc(100%-1.5rem)] max-w-[720px] -translate-x-1/2",
      )}
      style={compact
        ? { top: "calc(0.75rem + env(safe-area-inset-top, 0px))", left: "calc(0.75rem + env(safe-area-inset-left, 0px))" }
        : { bottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        ref={menuRef}
        id={menuId}
        role="dialog"
        aria-modal="false"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open ? true : undefined}
        onKeyDown={onMenuKeyDown}
        className={cn("ds-menu absolute inset-x-0 overflow-hidden rounded-sheet bg-raised shadow-e3", compact ? "top-0" : "bottom-0")}
        data-open={open}
        style={{ height: "min(560px, calc(100dvh - 7rem))" }}
      >
        <div className={cn("grid h-full content-start gap-5 overflow-y-auto px-3", compact ? "pb-4 pt-[68px]" : "pb-[76px] pt-4")}>
          <div className="grid gap-1">
            <h2 className="px-3 pb-1 font-ui-mono text-label uppercase text-ink-3">Go to</h2>
            <div className={cn("grid grid-cols-1 gap-1", !compact && "sm:grid-cols-2")}>{primary.map(item)}</div>
          </div>
          {(shownRecents.length > 0 || onOpenAllConversations) && (
            <div className="grid gap-1">
              <h2 className="px-3 pb-1 font-ui-mono text-label uppercase text-ink-3">Conversations</h2>
              {shownRecents.map((recent) => (
                <button
                  key={recent.id}
                  type="button"
                  data-menu-item=""
                  onClick={() => go(() => onOpenRecent?.(recent.id))}
                  className="ds-focus grid rounded-button px-3 py-2 text-left transition-colors hover:bg-glass"
                >
                  <span className="truncate text-body text-ink">{recent.title}</span>
                  {recent.meta && <span className="text-meta text-ink-3">{recent.meta}</span>}
                </button>
              ))}
              {onOpenAllConversations && (
                <button type="button" data-menu-item="" onClick={() => go(onOpenAllConversations)} className="ds-focus rounded-button px-3 py-2 text-left text-meta font-medium text-ink-2 hover:bg-glass hover:text-ink">
                  All conversations
                </button>
              )}
            </div>
          )}
          <div className="grid gap-1">
            <h2 className="px-3 pb-1 font-ui-mono text-label uppercase text-ink-3">AVA</h2>
            <div className={cn("grid grid-cols-1 gap-1", !compact && "sm:grid-cols-2")}>{system.map(item)}</div>
          </div>
        </div>
      </div>

      <form
        onSubmit={submit}
        className={cn(
          "ds-bar pointer-events-auto relative flex items-center gap-1.5 rounded-full shadow-e3",
          compact ? "h-[52px] w-[52px] justify-center p-0" : "h-[58px] px-2",
          open ? "bg-raised" : "ds-glass",
        )}
      >
        <button
          ref={orbRef}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => (open ? close() : setOpen(true))}
          className="ds-focus grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform duration-240 ease-spring active:scale-95"
        >
          {open ? <X size={20} aria-hidden="true" className="text-ink" /> : face ?? <span aria-hidden="true" className="ds-orb h-8 w-8 rounded-full" />}
        </button>
        <input
          aria-label="Message AVA"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={placeholder}
          inert={open || compact ? true : undefined}
          aria-hidden={compact || undefined}
          className={cn(
            "h-11 min-w-0 flex-1 bg-transparent px-1 text-body text-ink outline-none placeholder:text-ink-3 transition-opacity duration-150",
            open && "opacity-0",
            compact && "hidden",
          )}
        />
        {open && !compact && <span className="pointer-events-none absolute left-16 text-body text-ink">Menu</span>}
        {!compact && (canSend || !onTalk ? (
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="ds-focus relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-solid text-on-solid transition-[transform,opacity] duration-150 active:scale-95 disabled:opacity-40"
          >
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Talk to AVA"
            onClick={onTalk}
            className="ds-focus relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-solid text-on-solid transition-transform duration-150 active:scale-95"
          >
            <span aria-hidden="true" className="ds-shimmer" />
            <Mic size={19} aria-hidden="true" />
          </button>
        ))}
      </form>
    </nav>
  );
}
