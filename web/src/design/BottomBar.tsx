import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, AudioLines, Lightbulb, LoaderCircle, Mic, Square, X } from "lucide-react";
import { cn } from "./cn.js";
import { insertDictation, useDictation, type Transcribe } from "./dictation.js";
import { LightTrace } from "./metal/LightTrace.js";

export type Destination = {
  id: string;
  label: string;
  icon: ReactNode;
  group: "primary" | "system";
  /** Optional short state, e.g. "3 due". */
  meta?: string;
};

export type RecentConversation = { id: string; title: string; meta?: string };

/**
 * What a screen that owns a conversation (Talk) lends the bar, so the bar
 * becomes that conversation's message box instead of starting a new one.
 */
export type BarConversation = {
  /** Send into this conversation. */
  onSend: (text: string) => void;
  /** AVA is replying: Send becomes Stop, and nothing else can be sent. */
  busy: boolean;
  onStop: () => void;
  /** Continue this conversation by voice. */
  onVoice: () => void;
};

/**
 * Ideas AVA is waiting to share (contract ava-initiative): a dot on the mini
 * face, brighter while one is unopened, and the menu's first entry.
 */
export type BarIdeas = {
  /** e.g. "2 ideas from AVA"; also joins the menu button's name. */
  label: string;
  /** At least one has not been opened yet. */
  fresh: boolean;
  onOpen: () => void;
};

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
  /** AVA is replying in this conversation: Send becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
  /** Offers dictation into the draft. Nothing is ever sent by itself. */
  dictate?: Transcribe;
  /** Bump to put the cursor in the message box. */
  focusRequest?: number;
  placeholder?: string;
  /** The mini face: a static image, never a second WebGL canvas. */
  face?: ReactNode;
  ideas?: BarIdeas | null;
  /**
   * On screens with their own controls (Voice) the bar shrinks to the round
   * menu button in the top-left corner. It is the same mounted component, and
   * its hidden input keeps the draft.
   */
  compact?: boolean;
};

const LINE = 44;
const MAX_HEIGHT = 150;

/**
 * The only navigation in AVA (contract ui-remodel v2 §4): a conversation bar at
 * the bottom that grows into the menu, and on Talk is the message box itself.
 * The input stays mounted while the menu is open, so a draft is never lost.
 * Ctrl/Cmd+K toggles the menu, Esc closes it, arrow keys move between its items.
 * Enter sends; Shift+Enter starts a new line.
 */
export function BottomBar({
  destinations, current, onNavigate, recents = [], onOpenRecent, onOpenAllConversations,
  draft, onDraftChange, onSend, onTalk, sending = false, busy = false, onStop, dictate, focusRequest = 0,
  placeholder = "Ask AVA anything…", face, ideas, compact = false,
}: BottomBarProps) {
  const [open, setOpen] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [focused, setFocused] = useState(false);
  const menuId = useId();
  const statusId = useId();
  const draftStatusId = useId();
  const orbRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const dictation = useDictation({
    transcribe: dictate,
    enabled: Boolean(dictate) && !compact,
    onText: (transcript) => {
      onDraftChange(insertDictation(draftRef.current, transcript));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });
  const recording = dictation.state === "listening";
  const dictationActive = dictation.state === "requesting" || recording || dictation.state === "transcribing";

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

  useEffect(() => {
    if (focusRequest > 0 && !compact) inputRef.current?.focus();
  }, [focusRequest, compact]);

  // The box grows with its text, up to about six lines, then scrolls.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const height = Math.min(Math.max(input.scrollHeight, LINE), MAX_HEIGHT);
    input.style.height = `${height}px`;
    setMultiline(height > LINE);
  }, [draft]);

  // Screens pad their bottom by --ds-bar-space so nothing hides behind the bar,
  // however tall its draft grows.
  const formRef = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = navRef.current;
    if (compact || !bar) {
      root.style.setProperty("--ds-bar-space", "0px");
      return;
    }
    const publish = () => root.style.setProperty("--ds-bar-space", `${Math.ceil(bar.getBoundingClientRect().height) + 12}px`);
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [compact]);
  useEffect(() => () => { document.documentElement.style.removeProperty("--ds-bar-space"); }, []);

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

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending || busy || compact) return;
    onSend(text);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line; an input method mid-word never sends.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const primary = destinations.filter((d) => d.group === "primary");
  const system = destinations.filter((d) => d.group === "system");
  const pendingIdeas = ideas ?? null;
  const ideasLabel = pendingIdeas?.label ?? null;
  const faceNode = face ?? <span aria-hidden="true" className="ds-orb h-8 w-8 rounded-full" />;
  const shownRecents = recents.slice(0, 5);
  const canSend = Boolean(draft.trim()) && !sending && !busy;
  // Never collapse a conversation, active operation, focused field or unsent words.
  const expanded = open || focused || current === "talk" || draft.length > 0 || busy || sending || dictationActive;

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

  const roundButton = "ds-focus relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full transition-[transform,opacity] duration-150 active:scale-95";

  // While AVA replies, Stop takes the main place and voice stays one quiet tap away.
  const mainButton = busy && onStop ? (
    <>
      {onTalk && (
        <button type="button" aria-label="Talk to AVA" onClick={onTalk} className={cn(roundButton, "text-ink-2 hover:bg-glass")}>
          <Mic size={19} aria-hidden="true" />
        </button>
      )}
      <button type="button" aria-label="Stop AVA" onClick={onStop} className={cn(roundButton, "bg-solid text-on-solid")}>
        <Square size={15} fill="currentColor" aria-hidden="true" />
      </button>
    </>
  ) : canSend || !onTalk ? (
    <button type="submit" aria-label="Send" disabled={!canSend} className={cn(roundButton, "bg-solid text-on-solid disabled:opacity-40")}>
      <ArrowUp size={19} aria-hidden="true" />
    </button>
  ) : (
    <button type="button" aria-label="Talk to AVA" onClick={onTalk} className={cn(roundButton, "bg-solid text-on-solid")}>
      <span aria-hidden="true" className="ds-shimmer" />
      <Mic size={19} aria-hidden="true" />
    </button>
  );

  const dictationStatus = dictation.state === "requesting" ? "Asking for the microphone…"
    : recording ? "Listening. Tap stop when you're done; nothing sends by itself."
    : dictation.state === "transcribing" ? "Writing it into your draft…"
    : dictation.state === "error" ? dictation.error
    : null;

  return (
    <nav
      ref={navRef}
      aria-label="AVA"
      data-compact={compact || undefined}
      className={cn(
        "ds-root ds-navigation-host pointer-events-none fixed z-40 font-ui",
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
          {pendingIdeas && (
            <button
              type="button"
              data-menu-item=""
              onClick={() => go(pendingIdeas.onOpen)}
              className="ds-focus flex h-12 items-center gap-3 rounded-button bg-glass px-3 text-left text-body text-ink transition-colors duration-150 hover:bg-glass-strong"
            >
              <Lightbulb size={18} aria-hidden="true" className="text-ink-2" />
              <span className="min-w-0 flex-1 truncate">{ideasLabel}</span>
              {pendingIdeas.fresh && <span className="text-meta text-ink-3">New</span>}
            </button>
          )}
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

      {dictationStatus && !open && !compact && (
        <p
          id={statusId}
          role={dictation.state === "error" ? "alert" : "status"}
          className={cn(
            "ds-glass absolute bottom-full left-2 mb-2 max-w-[calc(100%-1rem)] rounded-full px-4 py-2 text-meta shadow-e1",
            dictation.state === "error" ? "text-danger" : "text-ink-2",
          )}
        >
          {dictationStatus}
        </p>
      )}

      {!compact && <div aria-hidden={open || undefined} inert={open ? true : undefined} style={{ visibility: open ? "hidden" : undefined }}>
        <LightTrace items={primary.filter((item) => item.id !== "new")} current={current} onNavigate={onNavigate} />
      </div>}

      <form
        ref={formRef}
        onSubmit={submit}
        data-expanded={expanded}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
        className={cn(
          "ds-bar pointer-events-auto relative flex gap-1.5 shadow-e3 transition-[border-radius] duration-150",
          compact ? "h-[52px] w-[52px] items-center justify-center rounded-full p-0" : "min-h-[58px] items-end px-2 py-[7px]",
          !compact && (multiline ? "rounded-sheet" : "rounded-full"),
          open ? "bg-raised" : "ds-metal-bar",
          !compact && "ds-composer-grow",
        )}
      >
        <button
          ref={orbRef}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : ideasLabel ? `Open menu, ${ideasLabel}` : "Open menu"}
          aria-describedby={compact && draft.length > 0 ? draftStatusId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
          className="ds-focus grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform duration-240 ease-spring active:scale-95"
        >
          {open ? <X size={20} aria-hidden="true" className="text-ink" /> : pendingIdeas ? (
            <span className="relative grid place-items-center">
              {faceNode}
              <span
                aria-hidden="true"
                data-idea-dot={pendingIdeas.fresh ? "new" : "seen"}
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bar",
                  pendingIdeas.fresh ? "bg-ink" : "bg-ink-3",
                )}
              />
            </span>
          ) : faceNode}
        </button>
        <textarea
          ref={inputRef}
          aria-label="Message AVA"
          aria-describedby={dictationStatus ? statusId : undefined}
          rows={1}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          inert={open || compact ? true : undefined}
          aria-hidden={compact || undefined}
          className={cn(
            // Rounded so the keyboard focus ring follows the pill instead of drawing a box inside it.
            "min-w-0 flex-1 resize-none rounded-button bg-transparent px-2 py-[11px] text-body leading-[22px] text-ink outline-none placeholder:text-ink-3 transition-opacity duration-150",
            open && "opacity-0",
            compact && "hidden",
          )}
          style={{ height: LINE }}
        />
        {open && !compact && <span className="pointer-events-none absolute left-16 top-[18px] text-body text-ink">Menu</span>}
        {!compact && dictate && (
          <>
            {dictationActive && (
              <button type="button" aria-label="Cancel dictation" onClick={dictation.cancel} className={cn(roundButton, "text-ink-2 hover:bg-glass")}>
                <X size={17} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              aria-label={recording ? "Stop dictation" : dictation.state === "error" ? "Retry dictation" : "Dictate message"}
              aria-pressed={recording}
              title={recording ? "Stop and write it into the draft" : "Speak into this draft"}
              onClick={recording ? dictation.finish : () => { void dictation.begin(); }}
              disabled={dictation.state === "requesting" || dictation.state === "transcribing"}
              className={cn(roundButton, recording ? "bg-glass-strong text-ink" : "text-ink-2 hover:bg-glass", "disabled:cursor-wait")}
            >
              {dictation.state === "requesting" || dictation.state === "transcribing"
                ? <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
                : recording ? <Square size={14} fill="currentColor" aria-hidden="true" /> : <AudioLines size={19} aria-hidden="true" />}
            </button>
          </>
        )}
        {!compact && mainButton}
      </form>
      {compact && draft.length > 0 && !open && <span id={draftStatusId} className="ds-draft-kept text-meta text-ink-2">Draft kept</span>}
    </nav>
  );
}
