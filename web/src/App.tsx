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
  CalendarDays,
  House,
  Lightbulb,
  MessageSquarePlus,
  MessageSquareText,
  NotebookPen,
  Presentation,
  Radar,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { Flip } from "./lib/gsap.js";
import { BottomBar, withViewTransition, type BarConversation, type Destination, type RecentConversation } from "./design/index.js";
import { SCREEN, markTransition } from "./lib/deckMotion.js";
import { useReducedMotion } from "./lib/useReducedMotion.js";
import { computeReduced } from "./lib/motionPref.js";
import { getToken } from "./auth/tokens.js";
import { fetchSessionPage, lastHumanActivity, transcribeAudio, type ConversationIntent } from "./api.js";
import { isCoarsePointer } from "./lib/media.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { TodayScreen } from "./today/TodayScreen.js";
import { HomeScreen } from "./home/HomeScreen.js";
import { FaceStill } from "./design/face/FaceStill.js";
import { Splash } from "./splash/Splash.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";
import { savedItemDestination, type SavedItem } from "./chat/saved-items.js";

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
// Only the first screens (pairing, the intro, Today) ship eagerly. Every other
// destination loads when it is first opened; the offline cache keeps each one
// a local fetch after the first visit.
const NotesScreen = lazy(async () => ({ default: (await import("./notes/NotesScreen.js")).NotesScreen }));
const IdeasScreen = lazy(async () => ({ default: (await import("./ideas/IdeasScreen.js")).IdeasScreen }));
const ScheduleScreen = lazy(async () => ({ default: (await import("./schedule/ScheduleScreen.js")).ScheduleScreen }));
const ChatListScreen = lazy(async () => ({ default: (await import("./orbit/ChatListScreen.js")).ChatListScreen }));
const WatchesScreen = lazy(async () => ({ default: (await import("./watches/WatchesScreen.js")).WatchesScreen }));
const RulesScreen = lazy(async () => ({ default: (await import("./rules/RulesScreen.js")).RulesScreen }));
const SelfScreen = lazy(async () => ({ default: (await import("./self/SelfScreen.js")).SelfScreen }));
const MissionControlScreen = lazy(async () => ({
  default: (await import("./mission-control/MissionControlScreen.js")).MissionControlScreen,
}));

type View =
  | { name: "splash" }
  // Home is the calm landing page (phase C redesigns it); until then it shows
  // the Today screen but stays its own destination and history entry.
  | { name: "home" }
  | { name: "today" }
  // Mission Control inside AVA; the standalone ?mission-control=1 window remains.
  | { name: "activity" }
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
  | { name: "visuals"; visualId?: string }
  | { name: "capabilities" }
  | { name: "list" };

// Only these surfaces own the mercury Orb (with flipId="ava-orb"): splash →
// Today → voice hero. ChatScreen renders NO orb, so it must not be listed here —
// otherwise entering chat would capture a still-exiting orb and the next orb
// view would Flip from a stale snapshot.
const VIEWS_WITH_ORB = ["splash", "today", "voice"];
const LAST_CHAT_STORAGE_KEY = "ava:last-chat-session";
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
    return shouldPlaySplash() ? { name: "splash" } : { name: "home" };
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

/** Which bottom-bar destination a view belongs to (contract ui-remodel v2 §4). */
function destinationForView(v: View): string | null {
  switch (v.name) {
    case "home": return "home";
    case "today": return "today";
    // A brand-new composition is "New chat"; every existing conversation, and the list of them, is Talk.
    case "chat": return v.sessionId === null ? "new" : "talk";
    case "list": return "talk";
    case "schedule": return "calendar";
    case "notes": return "notes";
    case "ideas": return "ideas";
    case "memory": return "memory";
    case "watches": return "reminders";
    case "capabilities": return "explore";
    case "visuals": return "visuals";
    case "activity": return "activity";
    case "self": return "self";
    case "rules": return "settings";
    default: return null;
  }
}

const DESTINATIONS: Destination[] = [
  { id: "new", label: "New chat", icon: <MessageSquarePlus size={18} />, group: "primary" },
  { id: "home", label: "Home", icon: <House size={18} />, group: "primary" },
  { id: "today", label: "Today", icon: <Sun size={18} />, group: "primary" },
  { id: "talk", label: "Talk", icon: <MessageSquareText size={18} />, group: "primary" },
  { id: "notes", label: "Notes", icon: <NotebookPen size={18} />, group: "primary" },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={18} />, group: "primary" },
  { id: "ideas", label: "Ideas", icon: <Lightbulb size={18} />, group: "primary" },
  { id: "memory", label: "Memory", icon: <Brain size={18} />, group: "system" },
  { id: "reminders", label: "Reminders & watches", icon: <AlarmClock size={18} />, group: "system" },
  { id: "explore", label: "Explore AVA", icon: <Radar size={18} />, group: "system" },
  { id: "visuals", label: "Visual explanations", icon: <Presentation size={18} />, group: "system" },
  { id: "activity", label: "Activity", icon: <Activity size={18} />, group: "system" },
  { id: "self", label: "Self development", icon: <Sparkles size={18} />, group: "system" },
  { id: "settings", label: "Settings", icon: <Settings2 size={18} />, group: "system" },
];

const RECENT_LIMIT = 5;

function formatRecentTime(value: number): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Nika's recent conversations for the menu: the scoped human-only list, with
 * the current conversation lifted to the top. A failed lookup shows nothing
 * rather than a wrong list; "All conversations" stays available.
 */
function useRecentConversations(currentSessionId: string | null, enabled: boolean): RecentConversation[] {
  const [recents, setRecents] = useState<RecentConversation[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await fetchSessionPage({ scope: "human", limit: RECENT_LIMIT });
        if (cancelled) return;
        const rows = [...page.sessions];
        const at = currentSessionId ? rows.findIndex((row) => row.id === currentSessionId) : -1;
        if (at > 0) rows.unshift(...rows.splice(at, 1));
        setRecents(rows.map((row) => ({
          id: row.id,
          title: row.title?.trim() || "Untitled conversation",
          meta: formatRecentTime(lastHumanActivity(row)),
        })));
      } catch {
        if (!cancelled) setRecents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentSessionId, enabled]);
  return recents;
}

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>(readInitialView);
  // A fresh-chat view can remain `sessionId:null` after ChatScreen internally
  // receives a server session. Incrementing this key makes a second press of
  // New genuinely discard that draft and mount a clean conversation.
  const [newChatRevision, setNewChatRevision] = useState(0);
  const [lastChatSessionId, setLastChatSessionId] = useState<string | null>(readStoredChat);
  // The bottom bar's draft lives here so menu changes and navigation never lose it.
  const [barDraft, setBarDraft] = useState("");
  const barSendLock = useRef(false);
  // While Talk is open it lends the bar its conversation: sends go there, Send
  // becomes Stop while AVA replies, and voice continues that conversation.
  const [talkBar, setTalkBar] = useState<BarConversation | null>(null);
  const [barFocus, setBarFocus] = useState(0);
  const putInBar = useCallback((text: string) => {
    setBarDraft(text);
    setBarFocus((request) => request + 1);
  }, []);
  // Opening Talk on a desktop puts the cursor straight in the box; phones skip
  // it so the soft keyboard doesn't cover the conversation uninvited.
  const talkOpen = talkBar !== null;
  useEffect(() => {
    if (talkOpen && !isCoarsePointer()) setBarFocus((request) => request + 1);
  }, [talkOpen]);
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

  // The conversation voice actually bound during the current voice visit. It is
  // tied to that visit's view object, so a later visit never inherits it.
  const voiceBindingRef = useRef<{ visit: View; sessionId: string } | null>(null);

  const openChat = useCallback((sessionId: string | null, options?: { audit?: boolean }) => {
    setView({ name: "chat", sessionId, ...(options?.audit ? { audit: true } : {}) });
  }, []);

  const openNewChat = (initialText?: string) => {
    setNewChatRevision((revision) => revision + 1);
    setView({ name: "chat", sessionId: null, ...(initialText ? { initialText } : {}) });
  };

  // Whatever this tab showed first (the intro, a reduced-motion skip or a deep
  // link), its first load is over: later reloads go straight to Today.
  useEffect(() => { markSplashSeen(); }, []);

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
  const openSavedItem = (item: SavedItem) => {
    const target = savedItemDestination(item);
    if (target.view === "notes") openNote(target.noteId);
    else if (target.view === "watches") setView({ name: "watches", focusWatchId: target.watchId });
    else if (target.view === "schedule") setView({ name: "schedule" });
    else setView({ name: "memory" });
  };
  const enterVoiceFromToday = () => setView({
    name: "voice",
    from: "today",
    sessionId: lastChatSessionId,
    intent: lastChatSessionId ? "resume" : "continue",
  });

  const goHome = () => setView({ name: "home" });

  const navigate = (id: string) => {
    switch (id) {
      case "new": openNewChat(); break;
      case "home": goHome(); break;
      case "today": setView({ name: "today" }); break;
      case "talk": openTalk(); break;
      case "notes": setView({ name: "notes" }); break;
      case "calendar": setView({ name: "schedule" }); break;
      case "ideas": setView({ name: "ideas" }); break;
      case "memory": setView({ name: "memory" }); break;
      case "reminders": setView({ name: "watches" }); break;
      case "explore": setView({ name: "capabilities" }); break;
      case "visuals": setView({ name: "visuals" }); break;
      case "activity": setView({ name: "activity" }); break;
      case "self": setView({ name: "self" }); break;
      case "settings": setView({ name: "rules" }); break;
      default: break;
    }
  };

  // One bar send becomes exactly one new conversation turn. The lock holds
  // until the resulting route commits, so a double press cannot start two.
  useEffect(() => { barSendLock.current = false; }, [view]);
  const sendFromBar = (text: string) => {
    if (talkBar) {
      talkBar.onSend(text);
      setBarDraft("");
      return;
    }
    if (barSendLock.current) return;
    barSendLock.current = true;
    setBarDraft("");
    withViewTransition(() => openNewChat(text));
  };

  const barCurrent = destinationForView(view);
  const barVisible = view.name !== "splash";
  // Voice has its own controls; the bar shrinks to its menu button there. On
  // Talk the bar is the message box.
  const barCompact = view.name === "voice";
  const recents = useRecentConversations(lastChatSessionId, paired && barVisible);

  // Shared entry timing — the previous screen is already unmounted.
  // A destination owns the stage exclusively. React removes the previous
  // destination in the same commit and only the incoming surface eases in.
  // That prevents Home chrome from lingering beneath another workspace and
  // avoids compositing two full application surfaces during navigation.
  const enterT = { duration: reduced ? 0.1 : SCREEN.enter, ease: SCREEN.easeEnter };
  const deckTransition = transitioning || undefined;

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;
  if (new URLSearchParams(window.location.search).get("mission-control") === "1") {
    return (
      <DeferredScreenBoundary resetKey="mission-control">
        <Suspense fallback={<DeferredScreenFallback />}>
          <MissionControlScreen />
        </Suspense>
      </DeferredScreenBoundary>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black text-white">
      <GlassFilter />
      <div className="ava-app-stage">
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
            <Splash onDone={goHome} />
          </motion.div>
        )}
        {view.name === "home" && (
          <motion.div
            key="home"
            data-view="home"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <HomeScreen
              onStartChat={(text) => openNewChat(text)}
              onOpenNote={openNote}
              onOpenCalendar={() => setView({ name: "schedule" })}
              onOpenReminders={() => setView({ name: "watches" })}
            />
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
        {view.name === "activity" && (
          <motion.div
            key="activity"
            data-view="activity"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            transition={enterT}
          >
            <MissionControlScreen />
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
              onOpenSessions={goHome}
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
              onOpenVisual={(visualId) => setView({ name: "visuals", visualId })}
              onOpenSaved={openSavedItem}
              onComposer={setTalkBar}
              onDraft={putInBar}
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
              onSessionBound={(sessionId) => {
                voiceBindingRef.current = { visit: view, sessionId };
                rememberChat(sessionId);
              }}
              // The unavailable conversation is the one voice last bound in this
              // visit (a new or continued chat), else the one it was entered with.
              onSessionUnavailable={() => {
                const bound = voiceBindingRef.current;
                forgetUnavailableChat(bound?.visit === view ? bound.sessionId : view.sessionId);
              }}
              onOpenConversations={() => setView({ name: "list" })}
              onExit={(sid) => {
                if (view.from === "chat") openChat(sid);
                else goHome();
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
              onClose={goHome}
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
            <RulesScreen onClose={goHome} />
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
            <SelfScreen onClose={goHome} />
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
              onClose={goHome}
              onOpenChat={(sid, options) => (sid ? openChat(sid, options) : openNewChat())}
            />
          </motion.div>
        )}
      </Suspense>
      </DeferredScreenBoundary>

      </div>
      {/* Mounted once, outside the route switch, so it never remounts on navigation. */}
      {barVisible && (
        <BottomBar
          destinations={DESTINATIONS}
          current={barCurrent}
          onNavigate={(id) => withViewTransition(() => navigate(id))}
          recents={recents}
          onOpenRecent={(sessionId) => withViewTransition(() => openChat(sessionId))}
          onOpenAllConversations={() => withViewTransition(() => setView({ name: "list" }))}
          draft={barDraft}
          onDraftChange={setBarDraft}
          onSend={sendFromBar}
          onTalk={talkBar ? talkBar.onVoice : enterVoiceFromToday}
          busy={talkBar?.busy ?? false}
          onStop={talkBar?.onStop}
          dictate={talkBar ? transcribeAudio : undefined}
          focusRequest={barFocus}
          placeholder={talkBar ? "Message AVA…" : undefined}
          compact={barCompact}
          face={<FaceStill size={32} />}
        />
      )}
    </div>
  );
}
