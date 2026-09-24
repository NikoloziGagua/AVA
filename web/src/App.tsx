import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlarmClock,
  Brain,
  CalendarClock,
  Lightbulb,
  MessageSquareText,
  MessagesSquare,
  NotebookPen,
  Presentation,
  Radar,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { Flip } from "./lib/gsap.js";
import { AppSidebar, type AppSidebarItem } from "./components/ava/AppSidebar.js";
import { SCREEN, markTransition } from "./lib/deckMotion.js";
import { useReducedMotion } from "./lib/useReducedMotion.js";
import { computeReduced } from "./lib/motionPref.js";
import { getToken } from "./auth/tokens.js";
import type { ConversationIntent } from "./api.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";
import { NotesScreen } from "./notes/NotesScreen.js";
import { SelfScreen } from "./self/SelfScreen.js";
import { TodayScreen } from "./today/TodayScreen.js";
import { IdeasScreen } from "./ideas/IdeasScreen.js";
import { ScheduleScreen } from "./schedule/ScheduleScreen.js";
import { ChatListScreen } from "./orbit/ChatListScreen.js";
import { MissionControlScreen } from "./mission-control/MissionControlScreen.js";
import { StrategyRoomScreen } from "./strategy/StrategyRoomScreen.js";
import { WatchesScreen } from "./watches/WatchesScreen.js";
import { Splash } from "./splash/Splash.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

// Measured heavyweight destinations load only at their real navigation
// boundaries. Chat and Visuals intentionally move together: each reaches the
// same Markdown/diagram graph, so deferring only one leaves that graph eager.
const ChatScreen = lazy(async () => ({
  default: (await import("./chat/ChatScreen.js")).ChatScreen,
}));
const MemoryScreen = lazy(async () => ({
  default: (await import("./memory/MemoryScreen.js")).MemoryScreen,
}));
const VoiceScreen = lazy(async () => ({
  default: (await import("./voice/VoiceScreen.js")).VoiceScreen,
}));
const ExplorerScreen = lazy(async () => ({
  default: (await import("./explorer/ExplorerScreen.js")).ExplorerScreen,
}));
const VisualsScreen = lazy(async () => ({
  default: (await import("./visuals/VisualsScreen.js")).VisualsScreen,
}));

type View =
  | { name: "splash" }
  | { name: "today" }
  // `audit` shows an automated run for reference without making it the current chat.
  | { name: "chat"; sessionId: string | null; initialText?: string; audit?: boolean }
  | { name: "voice"; from: "today" | "chat"; sessionId: string | null; intent: ConversationIntent }
  | { name: "memory" }
  // `noteId` opens that exact note once; `handoff` makes each navigation distinct.
  | { name: "notes"; noteId?: string; handoff?: number }
  | { name: "ideas" }
  | { name: "schedule" }
  | { name: "watches"; focusWatchId?: string | null; navigationOrigin?: "mission-control" }
  | { name: "rules" }
  | { name: "self" }
  | { name: "strategy"; sourceSessionId?: string }
  | { name: "visuals"; visualId?: string }
  | { name: "capabilities" }
  | { name: "list" };

// Only these surfaces own the mercury Orb (with flipId="ava-orb"): splash →
// Today → voice hero. ChatScreen renders NO orb, so it must not be listed here —
// otherwise entering chat would capture a still-exiting orb and the next orb
// view would Flip from a stale snapshot.
const VIEWS_WITH_ORB = ["splash", "today", "voice"];
const LAST_CHAT_STORAGE_KEY = "ava:last-chat-session";
// v2 resets the previous always-expanded desktop drawer. The compact rail is
// the calm default; people can opt back into the labelled panel explicitly.
const SIDEBAR_STORAGE_KEY = "ava:sidebar-expanded-v2";
// The intro plays once per browser tab; reloads go straight to Today.
const SPLASH_SEEN_KEY = "ava:splash-seen";
const WATCHER_LINK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Splash only on a tab's first load, and never under AVA's reduced motion. */
export function shouldPlaySplash(): boolean {
  try {
    if (window.sessionStorage.getItem(SPLASH_SEEN_KEY)) return false;
  } catch { /* storage blocked: fall through to the motion preference */ }
  return !computeReduced();
}

function markSplashSeen(): void {
  try { window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1"); } catch { /* non-critical */ }
}

function readInitialView(): View {
  if (typeof window === "undefined") return { name: "splash" };
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "watches" || params.get("from") !== "mission-control") {
    return shouldPlaySplash() ? { name: "splash" } : { name: "today" };
  }
  const requested = params.get("watch");
  return {
    name: "watches",
    focusWatchId: requested && WATCHER_LINK_ID.test(requested) ? requested : null,
    navigationOrigin: "mission-control",
  };
}

function readStoredChat(): string | null {
  try { return window.localStorage.getItem(LAST_CHAT_STORAGE_KEY); }
  catch { return null; }
}

function readSidebarPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch { /* storage can be unavailable in hardened browsers */ }
  return false;
}

export function DeferredScreenFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black" role="status" aria-live="polite">
      <span className="hud text-[10px] tracking-[0.2em] text-white/45">Loading workspace…</span>
    </div>
  );
}

type DeferredScreenBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  reload?: () => void;
};

/**
 * A stale service-worker page can request a chunk from the previous build after
 * a release. Suspense handles normal loading; this boundary makes that uncommon
 * failure explicit and recoverable without weakening module integrity.
 */
export class DeferredScreenBoundary extends Component<
  DeferredScreenBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ava] deferred workspace failed to load", error.message, info.componentStack);
  }

  componentDidUpdate(previous: DeferredScreenBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private reload = () => {
    if (this.props.reload) this.props.reload();
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="absolute inset-0 grid place-items-center bg-black px-6 text-center" role="alert">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <strong className="text-sm font-medium text-white">This workspace did not load.</strong>
          <span className="text-xs leading-5 text-white/55">
            AVA may have updated while this window was open. Reload to use the installed version.
          </span>
          <button className="btn-deck btn-ghost h-9 px-4 text-xs" type="button" onClick={this.reload}>
            Reload AVA
          </button>
        </div>
      </div>
    );
  }
}

/** Which sidebar destination to mark for a view. Voice/splash return undefined. */
function navForView(v: View): string | undefined {
  switch (v.name) {
    case "today": return "Today";
    // Only a brand-new (sessionId === null) composition lights "New"; every
    // existing conversation, and the list of them, is Talk.
    case "chat": return v.sessionId === null ? "New" : "Talk";
    case "list": return "Talk";
    case "schedule": return "Schedule";
    case "notes": return "Notes";
    case "ideas": return "Ideas";
    case "memory": return "Memory";
    case "watches": return "Watches";
    case "rules": return "Rules";
    case "self": return "Self";
    case "strategy": return "Room";
    case "visuals": return "Visuals";
    case "capabilities": return "Explore";
    default: return undefined;
  }
}

/** Mission Control, the same window voice's Activity button opens. */
function openActivity(): void {
  window.open("/?mission-control=1", "ava-mission-control", "popup,width=1500,height=920,resizable=yes,scrollbars=no");
}

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>(readInitialView);
  // A fresh-chat view can remain `sessionId:null` after ChatScreen internally
  // receives a server session. Incrementing this key makes a second press of
  // New genuinely discard that draft and mount a clean conversation.
  const [newChatRevision, setNewChatRevision] = useState(0);
  const [lastChatSessionId, setLastChatSessionId] = useState<string | null>(readStoredChat);
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarPreference);
  const reduced = useReducedMotion();

  // The ONE remembered conversation shared by Chat, Voice and the sidebar. It
  // moves only on an explicit selection or an authoritative binding (a chat
  // load of a conversation Nika can talk in, a sent message, a voice ack),
  // never because a list page happens not to include it.
  const lastChatRef = useRef(lastChatSessionId);
  const rememberChat = useCallback((sessionId: string) => {
    lastChatRef.current = sessionId;
    setLastChatSessionId(sessionId);
    try { window.localStorage.setItem(LAST_CHAT_STORAGE_KEY, sessionId); } catch { /* non-critical */ }
  }, []);

  /** Forget the remembered chat only when the conversation that turned out unavailable IS it. */
  const forgetUnavailableChat = useCallback((sessionId: string | null) => {
    if (!sessionId || lastChatRef.current !== sessionId) return;
    lastChatRef.current = null;
    setLastChatSessionId(null);
    try { window.localStorage.removeItem(LAST_CHAT_STORAGE_KEY); } catch { /* non-critical */ }
  }, []);

  const openChat = useCallback((sessionId: string | null, options?: { audit?: boolean }) => {
    setView({ name: "chat", sessionId, ...(options?.audit ? { audit: true } : {}) });
  }, []);

  const setSidebarOpen = useCallback((expanded: boolean) => {
    setSidebarExpanded(expanded);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded)); } catch { /* non-critical */ }
  }, []);

  const openNewChat = (initialText?: string) => {
    setNewChatRevision((revision) => revision + 1);
    setView({ name: "chat", sessionId: null, ...(initialText ? { initialText } : {}) });
  };

  // Expired/invalid token → back to pairing. api.ts dispatches `ava:unauthorized`
  // (+ clearToken) on a 401; we just listen and drop back to the pairing screen.
  useEffect(() => {
    const h = () => setPaired(false);
    window.addEventListener("ava:unauthorized", h);
    return () => window.removeEventListener("ava:unauthorized", h);
  }, []);

  // Consume the Mission Control deep link once. Replacing only the current
  // history entry keeps browser Back pointed at the originating Mission Control
  // view while preventing a later reload from repeatedly forcing Watches.
  useEffect(() => {
    if (view.name !== "watches" || view.navigationOrigin !== "mission-control") return;
    const clean = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", clean || "/");
  }, []);

  // ── Transition window: mark it so the always-on WebGL loops idle during the
  // overlap, and flag the deck panels so their glass tree drops backdrop-filter
  // (no per-frame re-blur while a subtree opacity-fades).
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    const ms = SCREEN.enter * 1000 + 40;
    markTransition(ms);
    setTransitioning(true);
    const t = window.setTimeout(() => setTransitioning(false), ms);
    return () => window.clearTimeout(t);
  }, [view]);

  // GSAP Flip: the shared orb glides between the surfaces that own it (splash →
  // home → voice) instead of cutting. The query is SCOPED to the entering view's
  // subtree (via data-view) so the concurrently-mounted exiting orb can't be
  // captured, and Flip.from targets that same entering orb explicitly. Panels
  // (and chat) own no orb → the state is nulled so a stale orb can't drive them.
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  useLayoutEffect(() => {
    if (reduced || !VIEWS_WITH_ORB.includes(view.name)) {
      flipStateRef.current = null;
      return;
    }
    const orb = document.querySelector(`[data-view='${view.name}'] [data-flip-id='ava-orb']`);
    if (!orb) {
      flipStateRef.current = null;
      return;
    }
    if (flipStateRef.current) {
      try {
        // `targets: orb` pins the animation to the ENTERING orb (ignores the
        // exiting one); no `scale:true` — the shorthand can't be reset by GSAP
        // and logged "scale not eligible for reset" on every orb view.
        Flip.from(flipStateRef.current, {
          targets: orb,
          duration: SCREEN.orb,
          ease: "power2.inOut",
          absolute: true,
        });
      } catch { /* degrade to no animation */ }
    }
    try { flipStateRef.current = Flip.getState(orb); } catch { flipStateRef.current = null; }
  }, [view.name, reduced]);

  // Talk continues the remembered conversation exactly; with none it shows
  // Nika's conversations.
  const openTalk = () => (lastChatSessionId ? openChat(lastChatSessionId) : setView({ name: "list" }));
  const openNote = (noteId: string) => setView({ name: "notes", noteId, handoff: Date.now() });
  const enterVoiceFromToday = () => setView({
    name: "voice",
    from: "today",
    sessionId: lastChatSessionId,
    intent: lastChatSessionId ? "resume" : "continue",
  });

  // Everyday destinations first; AVA's own tools live under System. Recent
  // conversations are fetched by the sidebar, this array is routing-only.
  const navItems: AppSidebarItem[] = [
    { name: "Today", label: "Today", icon: Sun, group: "primary", onSelect: () => setView({ name: "today" }) },
    { name: "Talk", label: "Talk", icon: MessageSquareText, group: "primary", onSelect: openTalk },
    { name: "Schedule", label: "Schedule", icon: CalendarClock, group: "primary", onSelect: () => setView({ name: "schedule" }) },
    { name: "Notes", label: "Notes", icon: NotebookPen, group: "primary", onSelect: () => setView({ name: "notes" }) },
    { name: "Ideas", label: "Ideas", icon: Lightbulb, group: "primary", onSelect: () => setView({ name: "ideas" }) },
    { name: "Activity", label: "Activity", icon: Activity, group: "system", onSelect: openActivity },
    { name: "Explore", label: "Explore AVA", icon: Radar, group: "system", onSelect: () => setView({ name: "capabilities" }) },
    { name: "Watches", label: "Watches", icon: AlarmClock, group: "system", onSelect: () => setView({ name: "watches" }) },
    { name: "Memory", label: "Memory", icon: Brain, group: "system", onSelect: () => setView({ name: "memory" }) },
    { name: "Room", label: "Strategy Room", icon: MessagesSquare, group: "system", onSelect: () => setView({ name: "strategy" }) },
    { name: "Visuals", label: "Visual explanations", icon: Presentation, group: "system", onSelect: () => setView({ name: "visuals" }) },
    { name: "Rules", label: "Settings & rules", icon: Settings2, group: "system", onSelect: () => setView({ name: "rules" }) },
    { name: "Self", label: "Self development", icon: Sparkles, group: "system", onSelect: () => setView({ name: "self" }) },
  ];
  const activeNav = navForView(view);
  const showNav = activeNav !== undefined;

  // Shared entry timing — the previous screen is already unmounted.
  // A destination owns the stage exclusively. React removes the previous
  // destination in the same commit and only the incoming surface eases in.
  // That prevents Home chrome from lingering beneath another workspace and
  // avoids compositing two full application surfaces during navigation.
  const enterT = { duration: reduced ? 0.1 : SCREEN.enter, ease: SCREEN.easeEnter };
  const deckTransition = transitioning || undefined;

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;
  if (new URLSearchParams(window.location.search).get("mission-control") === "1") {
    return <MissionControlScreen />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black text-white">
      <GlassFilter />
      <AppSidebar
        items={navItems}
        activeName={activeNav}
        visible={showNav}
        expanded={sidebarExpanded}
        activeChatSessionId={lastChatSessionId}
        onExpandedChange={setSidebarOpen}
        onNewChat={() => openNewChat()}
        onOpenChat={(sessionId) => openChat(sessionId)}
        onOpenAllChats={() => setView({ name: "list" })}
      />
      <div
        className="ava-app-stage"
        data-sidebar-visible={showNav || undefined}
      >
      {/* Exactly one route surface is mounted at a time. Entry motion is small
          and compositor-only; destination changes never retain the old Home
          scene or run two heavyweight workspaces concurrently. */}
      <DeferredScreenBoundary resetKey={view.name}>
      <Suspense fallback={<DeferredScreenFallback />}>
        {view.name === "splash" && (
          <motion.div
            key="splash"
            data-view="splash"
            className="absolute inset-0"
          >
            <Splash onDone={() => { markSplashSeen(); setView({ name: "today" }); }} />
          </motion.div>
        )}
        {view.name === "today" && (
          <motion.div
            key="today"
            data-view="today"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <TodayScreen
              onOpenChat={(sessionId) => openChat(sessionId)}
              onStartChat={(text) => openNewChat(text)}
              // Voice goes back to the remembered conversation exactly; with none
              // remembered the server continues Nika's latest human chat.
              onEnterVoice={enterVoiceFromToday}
              onOpenTalk={() => setView({ name: "list" })}
              onOpenNote={openNote}
              onOpenIdeas={() => setView({ name: "ideas" })}
              onOpenNotes={() => setView({ name: "notes" })}
            />
          </motion.div>
        )}
        {view.name === "ideas" && (
          <motion.div
            key="ideas"
            data-view="ideas"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <IdeasScreen onOpenNote={openNote} />
          </motion.div>
        )}
        {view.name === "schedule" && (
          <motion.div
            key="schedule"
            data-view="schedule"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <ScheduleScreen onOpenTalk={openTalk} />
          </motion.div>
        )}
        {view.name === "chat" && (
          <motion.div
            key={view.sessionId ? `chat-${view.sessionId}` : `chat-new-${newChatRevision}`}
            data-view="chat"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <ChatScreen
              sessionId={view.sessionId}
              initialText={view.initialText}
              audit={view.audit === true}
              onSessionChange={rememberChat}
              onSessionUnavailable={forgetUnavailableChat}
              onNewChat={() => openNewChat()}
              onOpenSessions={() => setView({ name: "today" })}
              onOpenRules={() => setView({ name: "rules" })}
              onOpenMemory={() => setView({ name: "memory" })}
              onOpenList={() => setView({ name: "list" })}
              // A blank chat is an explicit new conversation, never "resume latest".
              onEnterVoice={(sessionId) => setView({
                name: "voice",
                from: "chat",
                sessionId,
                intent: sessionId ? "resume" : "new",
              })}
              onOpenStrategy={(sessionId) => setView({ name: "strategy", sourceSessionId: sessionId })}
              onOpenVisual={(visualId) => setView({ name: "visuals", visualId })}
            />
          </motion.div>
        )}
        {view.name === "voice" && (
          <motion.div
            key="voice"
            data-view="voice"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <VoiceScreen
              initialSessionId={view.sessionId}
              intent={view.intent}
              onSessionBound={rememberChat}
              onSessionUnavailable={() => forgetUnavailableChat(view.sessionId)}
              onOpenConversations={() => setView({ name: "list" })}
              onExit={(sid) => {
                if (view.from === "chat") openChat(sid);
                else setView({ name: "today" });
              }}
              onSwitchToKeyboard={(sid) => openChat(sid)}
            />
          </motion.div>
        )}
        {view.name === "memory" && (
          <motion.div
            key="memory"
            data-view="memory"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <MemoryScreen
              onClose={() => setView({ name: "today" })}
              onOpenChat={(sessionId) => openChat(sessionId)}
            />
          </motion.div>
        )}
        {view.name === "rules" && (
          <motion.div
            key="rules"
            data-view="rules"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <RulesScreen onClose={() => setView({ name: "today" })} />
          </motion.div>
        )}
        {view.name === "self" && (
          <motion.div
            key="self"
            data-view="self"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <SelfScreen onClose={() => setView({ name: "today" })} />
          </motion.div>
        )}
        {view.name === "notes" && (
          <motion.div
            // A new key per handoff mounts Notes afresh, so each "open this
            // note" is applied exactly once.
            key={view.noteId ? `notes-${view.noteId}-${view.handoff ?? 0}` : "notes"}
            data-view="notes"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <NotesScreen
              onStartTask={(text) => openNewChat(text)}
              onOpenChat={(sessionId) => openChat(sessionId)}
              initialNoteId={view.noteId ?? null}
            />
          </motion.div>
        )}
        {view.name === "strategy" && (
          <motion.div
            key={view.sourceSessionId ? `strategy-${view.sourceSessionId}` : "strategy"}
            data-view="strategy"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <StrategyRoomScreen
              sourceSessionId={view.sourceSessionId ?? null}
              onOpenChat={(sessionId) => openChat(sessionId)}
            />
          </motion.div>
        )}
        {view.name === "watches" && (
          <motion.div
            key="watches"
            data-view="watches"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <WatchesScreen
              onOpenChat={(sessionId) => openChat(sessionId, { audit: true })}
              focusWatchId={view.focusWatchId}
              navigationRequested={view.navigationOrigin === "mission-control"}
              onBackToMissionControl={() => window.history.back()}
            />
          </motion.div>
        )}
        {view.name === "visuals" && (
          <motion.div
            key={view.visualId ? `visuals-${view.visualId}` : "visuals"}
            data-view="visuals"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <VisualsScreen
              initialVisualId={view.visualId ?? null}
              onCreate={(text) => openNewChat(text)}
            />
          </motion.div>
        )}
        {view.name === "capabilities" && (
          <motion.div
            key="capabilities"
            data-view="capabilities"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <ExplorerScreen
              onLaunch={(text) => openNewChat(text)}
            />
          </motion.div>
        )}
        {view.name === "list" && (
          <motion.div
            key="list"
            data-view="list"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <ChatListScreen
              onClose={() => setView({ name: "today" })}
              onOpenChat={(sid, options) => (sid ? openChat(sid, options) : openNewChat())}
            />
          </motion.div>
        )}
      </Suspense>
      </DeferredScreenBoundary>

      </div>
    </div>
  );
}
