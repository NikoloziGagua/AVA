import { useEffect, useMemo, useRef, useState } from "react";
import { History, ListChecks, SquarePen } from "lucide-react";
import { api, fetchSession, fetchSuggestedChips, ApiError, type SessionMessage, type SessionOrigin, type SuggestedChip } from "../api.js";
import { isSessionUnavailable, mintBindingRequestId } from "./conversation-binding.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { useChatStream } from "./useChatStream.js";
import { StepsSheet } from "./StepsSheet.js";
import { deriveSteps, isExecuting, currentTool } from "./activity-steps.js";
import { fetchVisualExplanation } from "../visuals/api.js";
import type { VisualMessage, VisualMessageContext } from "../visuals/types.js";
import type { SavedItem } from "./saved-items.js";
import { validRoomPosts } from "./room-posts.js";
import { Chip } from "../design/Chip.js";
import { Button } from "../design/Button.js";
import { ErrorState } from "../design/States.js";
import { StatusIsland, type IslandMode } from "../design/StatusIsland.js";
import { FaceStill } from "../design/face/FaceStill.js";
import type { BarConversation } from "../design/BottomBar.js";
import { useInvitation, type InvitationRef } from "../initiative/useInvitation.js";
import { IdeaUnavailable, InvitationNav, InvitationPanel } from "../initiative/InvitationPanel.js";

export interface ChatScreenProps {
  sessionId: string | null;
  /** When opening a fresh chat from the home command bar: auto-send this once. */
  initialText?: string;
  // Navigation now lives in the persistent AppSidebar (App.tsx). These props
  // are kept inert so the App.tsx call site doesn't need to change.
  onOpenSessions: () => void;
  onOpenRules: () => void;
  onOpenMemory: () => void;
  onOpenList?: () => void;
  /** Continue this exact canonical conversation using speech input. */
  onEnterVoice?: (sessionId: string | null) => void;
  /**
   * Reports the conversation Nika is now in: after loading one she can talk in,
   * and after each accepted message. Never reported for automated runs.
   */
  onSessionChange?: (sessionId: string) => void;
  /** The exact conversation asked for is gone; the app stops remembering it. */
  onSessionUnavailable?: (sessionId: string) => void;
  /** Show this conversation for reference only (an automated run opened from Watches). */
  audit?: boolean;
  /**
   * Talk opened with no remembered conversation (one-conversation v1 Phase A):
   * the first send asks the server to continue Nika's most recent conversation
   * instead of guessing it here.
   */
  continueLatest?: boolean;
  /** "New topic": a fresh conversation, exactly what New chat was. */
  onNewChat?: () => void;
  /** Reopen this exact conversation from the server (a clean reload of its whole history). */
  onOpenChat?: (sessionId: string) => void;
  onOpenVisual?: (visualId: string) => void;
  /** Open something AVA saved during a reply (a Saved card row). */
  onOpenSaved?: (item: SavedItem) => void;
  /**
   * Talk's message box is the app's bottom bar (contract ui-remodel v2 §7). The
   * screen lends it this conversation's send, stop and voice while it is open.
   */
  onComposer?: (bar: BarConversation | null) => void;
  /** Put text into the bar's draft (a suggestion, or words a failed send gives back). */
  onDraft?: (text: string) => void;
  /** The idea behind this conversation, when it was opened as one (contract ava-initiative). */
  initiativeId?: string | null;
  /** Opened from a link or as an idea: show it only if this pair matches one idea. */
  verifyInitiative?: boolean;
  /** Put the cursor in the message box without touching the draft. */
  onFocusComposer?: () => void;
  onOpenNote?: (noteId: string) => void;
  onOpenCalendarAt?: (at: number, occurrenceKey: string) => void;
  /** Go to a newer or older pending idea. */
  onOpenInvitation?: (target: InvitationRef) => void;
  /** An idea was opened or answered, so the bar's count should refresh. */
  onInitiativeChange?: () => void;
}

/**
 * The text of the most recent assistant message that follows the last user
 * message — the SAME rule the server replays on stream connect
 * (chat.ts `latestAssistantAfterLastUser`). Computed from the RAW server rows so
 * a trailing `system` recovery row (recovery.ts appends "Server restarted…")
 * can't poison the compare: the old code mapped `system`→assistant and took the
 * last such bubble, which never matched the server's strict-assistant replay and
 * duplicated the final on reopen.
 */
/** Stored rows → bubbles. Shared by opening a conversation and by continue-intent hydration. */
function toChatMessages(rows: SessionMessage[]): ChatMessage[] {
  return rows.map((m) => ({
    id: `s-${m.id}`,
    createdAt: m.created_at,
    // `system` rows stay `system` (rendered as a notice) — collapsing them
    // into assistant bubbles both misattributed them to Ava AND broke the
    // reopen dedupe below.
    role: m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant",
    text: m.content,
    ...(m.role === "user" && m.metadata?.inputSource === "voice_exact_text" ? { inputSource: "voice_exact_text" as const } : {}),
    ...(m.role === "user" && m.metadata?.inputModality ? { inputModality: m.metadata.inputModality } : {}),
    ...(m.role === "user" && m.metadata?.visualContext ? { visualContext: m.metadata.visualContext } : {}),
    ...(m.role === "assistant" && m.visualMessages?.length ? { visualMessages: m.visualMessages } : {}),
    ...(m.role === "assistant" && m.metadata?.memoryContext ? { memoryContext: m.metadata.memoryContext } : {}),
    ...(m.role === "assistant" && m.metadata?.savedItems ? { savedItems: m.metadata.savedItems } : {}),
    ...(m.role === "assistant" && validRoomPosts(m.metadata?.roomPosts) ? { roomPosts: validRoomPosts(m.metadata?.roomPosts)! } : {}),
  }) as ChatMessage);
}

/**
 * The rows before a just-sent turn, for continue-intent hydration
 * (one-conversation v2). The server reports the accepted turn's exact stored
 * row id; rows before that row are ours to show, and it and everything after
 * are not (the screen already shows that turn and streams its reply). Equal
 * text, times and order never identify a turn. Anything but exactly one user
 * row with that id means nothing is prepended rather than guessing.
 */
export function rowsBeforeTurn(rows: SessionMessage[], userMessageId: number | null | undefined): SessionMessage[] | null {
  if (typeof userMessageId !== "number") return null;
  const hits = rows.map((row, index) => (row.id === userMessageId ? index : -1)).filter((index) => index >= 0);
  if (hits.length !== 1 || rows[hits[0]!]!.role !== "user") return null;
  return rows.slice(0, hits[0]!);
}

function latestAssistantAfterLastUser(
  messages: Array<{ role: string; content: string }>,
): string | null {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") { lastUserIdx = i; break; }
  }
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.content.trim()) return m.content;
  }
  return null;
}

export function ChatScreen({
  sessionId: requestedSessionId,
  initialText,
  onEnterVoice,
  onSessionChange,
  onSessionUnavailable,
  audit = false,
  continueLatest = false,
  onNewChat,
  onOpenChat,
  onOpenList,
  onOpenSaved,
  onComposer,
  onDraft,
  initiativeId: linkedInitiativeId = null,
  verifyInitiative = false,
  onFocusComposer,
  onOpenNote,
  onOpenCalendarAt,
  onOpenInvitation,
  onInitiativeChange,
}: ChatScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The conversation this screen is in right now, readable from async callbacks.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  // Creation provenance of the loaded conversation. Automated runs are shown
  // read-only; the server would refuse a human turn into them anyway.
  const [origin, setOrigin] = useState<SessionOrigin | undefined>(undefined);
  // A conversation AVA started: its idea, and whether Niko has replied yet.
  const [invite, setInvite] = useState<{ initiativeId: string | null; unreplied: boolean } | null>(null);
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  // The exact conversation asked for is gone. Nothing is switched silently.
  const [unavailable, setUnavailable] = useState(false);
  // One-time key for this screen's "new conversation", reused if the first
  // send is retried so a lost response can't create a second conversation.
  const newConversationKeyRef = useRef<string | null>(null);
  // A send answered after Nika navigated elsewhere must not steer the app:
  // late answers from an unmounted screen are dropped.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  // The server's run id is also the diagnostic id carried by the receipt. Pass
  // it back on the SSE connection so a fast-finish replay cannot accidentally
  // surface an older receipt from the same conversation.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [visualsByEpoch, setVisualsByEpoch] = useState<Record<number, VisualMessage[]>>({});
  const [attachedVisualContext, setAttachedVisualContext] = useState<VisualMessageContext | null>(null);
  // Reopen fetch failure (401 / network / deleted id). Non-null → render a
  // retry/error panel instead of a silent blank screen with a live composer.
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped by the error panel's Retry to re-run the reopen fetch.
  const [reloadNonce, setReloadNonce] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch, taskId);
  const [chips, setChips] = useState<SuggestedChip[]>([]);
  useEffect(() => {
    fetchSuggestedChips().then(setChips).catch(() => {});
  }, []);
  // Synchronous optimistic-send flag: flips true the same frame send() fires,
  // BEFORE the awaited POST resolves — `busy` lags by the full round-trip, so
  // this is what makes the thinking indicator instant.
  const [pending, setPending] = useState(false);
  // The conversation's scroll element (MessageList keeps the newest line in view).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Last assistant message in the SEEDED history. On reopen the server replays
  // the run's `final` on stream connect; for a finished run that text is already
  // the last persisted assistant message, so rendering/promoting the replay
  // would duplicate the final bubble. Captured once per fetch (the `s-` rows
  // never change), so the dedupe stays stable across later re-renders.
  const seededLastAssistantRef = useRef<string | null>(null);
  const loadedVisualEventRefs = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    if (requestedSessionId === null) {
      setSessionId(null);
      setInvite(null);
      setHistory([]);
      setRunEpoch(0);
      setTaskId(null);
      setVisualsByEpoch({});
      setAttachedVisualContext(null);
      seededLastAssistantRef.current = null;
      return;
    }
    fetchSession(requestedSessionId)
      .then((data) => {
        if (cancelled) return;
        const loaded = toChatMessages(data.messages);
        // Dedupe target = server's replay rule over the RAW rows (not the last
        // mapped bubble), so a trailing `system` row can't shadow the real final.
        seededLastAssistantRef.current = latestAssistantAfterLastUser(data.messages);
        setHistory(loaded);
        setSessionId(requestedSessionId);
        setOrigin(data.session.origin);
        const unrepliedInvitation = data.session.origin === "assistant" && !data.session.last_human_activity_at;
        setInvite(data.session.origin === "assistant"
          ? { initiativeId: data.session.initiativeId ?? null, unreplied: unrepliedInvitation }
          : { initiativeId: null, unreplied: false });
        setUnavailable(false);
        // Explicitly opening a conversation selects it, older unclassified ones
        // included. Automated runs, and anything opened for reference, never
        // become the conversation Chat and Voice continue. Neither does an idea
        // AVA is still waiting on, or one opened from a link: the first reply
        // selects it (ava-initiative v2).
        if (!audit && !verifyInitiative && !unrepliedInvitation && data.session.origin !== "automation") {
          onSessionChange?.(requestedSessionId);
        }
        setRunEpoch(0);
        setTaskId(null);
        setVisualsByEpoch({});
        setAttachedVisualContext(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (isSessionUnavailable(e)) {
          setUnavailable(true);
          onSessionUnavailable?.(requestedSessionId);
          return;
        }
        // 401 is already centralized in api.ts (clearToken + ava:unauthorized →
        // App routes to pairing); here we just surface a panel so the screen is
        // never a silent dead blank.
        setLoadError(e);
      });
    return () => { cancelled = true; };
  }, [audit, verifyInitiative, onSessionChange, onSessionUnavailable, requestedSessionId, reloadNonce]);

  // Promote a completed run's final into history exactly once.
  // Bug fix: previously the lastFinal lived in `events` only; on the next
  // user turn it disappeared, making subsequent user messages stack
  // directly under the previous one with Ava's reply missing.
  useEffect(() => {
    const completedEpochs = new Set<number>();
    for (const e of events) {
      if (e.kind === "done" || e.kind === "killed" || e.kind === "error") {
        completedEpochs.add(e.runEpoch);
      }
    }
    if (completedEpochs.size === 0) return;
    setHistory((prev) => {
      let next = prev;
      for (const epoch of completedEpochs) {
        const id = `a-${epoch}`;
        const inlineVisuals = visualsByEpoch[epoch] ?? [];
        const memoryContext = [...events]
          .reverse()
          .find((event) => event.runEpoch === epoch && event.kind === "memory_context");
        const savedItems = [...events]
          .reverse()
          .find((event) => event.runEpoch === epoch && event.kind === "saved_items");
        const roomPosts = [...events]
          .reverse()
          .find((event) => event.runEpoch === epoch && event.kind === "room_posts");
        const existingIndex = next.findIndex((m) => m.id === id);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          if (existing?.role === "assistant" &&
              ((inlineVisuals.length && existing.visualMessages !== inlineVisuals) ||
               (memoryContext?.kind === "memory_context" && existing.memoryContext !== memoryContext.payload) ||
               (savedItems?.kind === "saved_items" && existing.savedItems !== savedItems.payload) ||
               (roomPosts?.kind === "room_posts" && existing.roomPosts !== roomPosts.payload))) {
            next = next.map((message, index) => index === existingIndex ? {
              ...existing,
              ...(inlineVisuals.length ? { visualMessages: inlineVisuals } : {}),
              ...(memoryContext?.kind === "memory_context" ? { memoryContext: memoryContext.payload } : {}),
              ...(savedItems?.kind === "saved_items" ? { savedItems: savedItems.payload } : {}),
              ...(roomPosts?.kind === "room_posts" ? { roomPosts: roomPosts.payload } : {}),
            } : message);
          }
          continue;
        }
        const final = [...events]
          .reverse()
          .find((e) => e.runEpoch === epoch && e.kind === "final");
        if (!final || final.kind !== "final") continue;
        // Epoch 0 only exists when REOPENING a chat (a local send always bumps
        // to ≥1), so its final is a server replay — skip it when it matches the
        // seeded history's last assistant message (already rendered there).
        // Locally-run epochs are never deduped, so an intentionally repeated
        // reply still shows.
        if (epoch === 0 && final.payload.text === seededLastAssistantRef.current) continue;
        next = [...next, {
          id,
          role: "assistant",
          text: final.payload.text,
          ...(inlineVisuals.length ? { visualMessages: inlineVisuals } : {}),
          ...(memoryContext?.kind === "memory_context" ? { memoryContext: memoryContext.payload } : {}),
          ...(savedItems?.kind === "saved_items" ? { savedItems: savedItems.payload } : {}),
          ...(roomPosts?.kind === "room_posts" ? { roomPosts: roomPosts.payload } : {}),
        }];
      }
      return next;
    });
  }, [events, visualsByEpoch]);

  // A successful visual tool result carries the exact server-issued revision.
  // Resolve it into the assistant message rather than navigating away. Repeated
  // SSE delivery is idempotent by event key and visual id/revision.
  useEffect(() => {
    const created = events.filter((event) =>
      event.kind === "tool_result" &&
      (event.payload.tool === "visual_explanation_create" || event.payload.tool === "research_visual_create") &&
      event.payload.ok,
    );
    for (const event of created) {
      if (event.kind !== "tool_result") continue;
      const key = `${event.runEpoch}-${event.id}`;
      if (loadedVisualEventRefs.current.has(key)) continue;
      let visualId = "";
      let revision: number | undefined;
      try {
        const parsed = JSON.parse(event.payload.result) as {
          visualMessageId?: unknown;
          visualExplanationId?: unknown;
          revision?: unknown;
        };
        visualId = typeof parsed.visualMessageId === "string"
          ? parsed.visualMessageId
          : typeof parsed.visualExplanationId === "string" ? parsed.visualExplanationId : "";
        if (typeof parsed.revision === "number" && Number.isInteger(parsed.revision)) revision = parsed.revision;
      } catch { continue; }
      if (!/^visual_[A-Za-z0-9_-]{8,32}$/.test(visualId)) continue;
      loadedVisualEventRefs.current.add(key);
      void fetchVisualExplanation(visualId, revision)
        .then((visual) => setVisualsByEpoch((current) => {
          const existing = current[event.runEpoch] ?? [];
          if (existing.some((item) => item.visualMessageId === visual.visualMessageId && item.revision === visual.revision)) return current;
          return { ...current, [event.runEpoch]: [...existing, visual] };
        }))
        .catch(() => { loadedVisualEventRefs.current.delete(key); });
    }
  }, [events]);

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error"),
  );
  // Busy is derived from the STREAM, not the local runEpoch counter: reopening
  // a chat resets runEpoch to 0, so the old `runEpoch > 0` gate made a reopened
  // MID-RUN chat read as idle — no Stop button, no thinking indicator, the run
  // streaming invisibly. An event seen for the current run without its terminal
  // event means the run is live; `pending` covers the send→first-event window.
  const currentRunSeen = events.some((e) => e.runEpoch === runEpoch);
  const streamBusy = currentRunSeen && !currentRunFinished;
  const busy = pending || streamBusy;
  const isEmpty = history.length === 0 && events.length === 0 && requestedSessionId === null && !unavailable;
  // Automated runs are evidence to read, not a conversation to continue.
  const readOnly = audit || origin === "automation";

  // The conversation's own idea wins; a link naming a different one matches nothing.
  const rowInitiativeId = invite?.initiativeId ?? null;
  const pairedInitiativeId = rowInitiativeId && linkedInitiativeId && rowInitiativeId !== linkedInitiativeId
    ? null
    : rowInitiativeId ?? linkedInitiativeId;
  const invitation = useInvitation({
    sessionId: invite ? sessionId : null,
    initiativeId: pairedInitiativeId,
    unreplied: invite?.unreplied ?? false,
    verify: verifyInitiative,
    onChange: onInitiativeChange,
  });
  const ideaState = invitation.state;
  const ideaUnavailable = verifyInitiative && (unavailable || ideaState.status === "unavailable");
  const ideaChecking = verifyInitiative && !ideaUnavailable && !loadError && ideaState.status === "loading";

  const headerState: "idle" | "thinking" | "responding" =
    busy
      ? events.some((e) => e.runEpoch === runEpoch && e.kind === "final")
        ? "responding"
        : "thinking"
      : "idle";

  // Filter live events: only current run, and skip its final once it's
  // been promoted into history (avoid duplicate rendering) — or when it's an
  // epoch-0 replay of the last persisted assistant message (same dedupe as the
  // promote effect above, so neither path renders the duplicate).
  const promotedCurrent = history.some((m) => m.id === `a-${runEpoch}`);
  const seededAssistant = [...history].reverse().find((message) => message.role === "assistant");
  const liveEvents = events.filter((e) => {
    if (e.runEpoch !== runEpoch) return false;
    if (e.kind === "final" && (promotedCurrent ||
        (e.runEpoch === 0 && e.payload.text === seededLastAssistantRef.current))) return false;
    if (e.kind === "memory_context" && (promotedCurrent ||
        (e.runEpoch === 0 && seededAssistant?.role === "assistant" && seededAssistant.memoryContext))) return false;
    if (e.kind === "saved_items" && (promotedCurrent ||
        (e.runEpoch === 0 && seededAssistant?.role === "assistant" && seededAssistant.savedItems))) return false;
    if (e.kind === "room_posts" && (promotedCurrent ||
        (e.runEpoch === 0 && seededAssistant?.role === "assistant" && seededAssistant.roomPosts))) return false;
    return true;
  });

  // Activity / working-mode derivation from the live stream.
  const steps = deriveSteps(liveEvents);
  const executing = isExecuting(liveEvents);
  const runningTool = currentTool(liveEvents);

  // Optimistic thinking: instant on send (pending), held through busy, dropped
  // the moment the run's final lands or the run terminates. Pending hands off
  // to streamBusy (not `busy`, which pending itself feeds) once events arrive.
  const lastFinalCurrent = events.some((e) => e.runEpoch === runEpoch && e.kind === "final");
  useEffect(() => {
    if (streamBusy || currentRunFinished) setPending(false);
  }, [streamBusy, currentRunFinished]);
  const optimisticThinking = busy && !lastFinalCurrent && !currentRunFinished;

  // What AVA is doing, at the top of Talk (contract ui-remodel v2 §4). A request
  // waiting for Niko outranks everything; then a running step; then thinking.
  const [stepsOpen, setStepsOpen] = useState(false);
  const waitingApproval = liveEvents.some((e) =>
    e.kind === "approval_required" &&
    !liveEvents.some((r) => r.kind === "approval_resolved" && r.payload.id === e.payload.id));
  const island: { mode: IslandMode; text?: string; detail?: string } = waitingApproval
    ? { mode: "attention", detail: "Approve or decline below" }
    : executing
      ? { mode: "working", ...(runningTool ? { detail: runningTool } : {}) }
      : busy
        ? headerState === "responding" ? { mode: "thinking", text: "Writing" } : { mode: "thinking" }
        : { mode: "idle" };

  // The conversation a continue-intent send landed in already had messages:
  // show them above this turn, once. Dropped if this screen has since moved
  // to another conversation or unmounted; a failed fetch loses nothing, as
  // the next open shows the whole conversation.
  const hydratedRef = useRef<string | null>(null);
  function hydrateContinued(bound: string, userMessageId: number | null | undefined) {
    if (hydratedRef.current !== null) return;
    hydratedRef.current = bound;
    fetchSession(bound).then((data) => {
      // An abandoned screen or a different conversation is dropped silently; a response for the
      // wrong session on this screen is unsafe history and gets the honest note.
      if (unmountedRef.current || sessionIdRef.current !== bound) return;
      const before = data.session.id === bound ? rowsBeforeTurn(data.messages, userMessageId) : null;
      if (before === null) { setHistoryNote(true); return; }
      const earlier = toChatMessages(before);
      setOrigin(data.session.origin);
      if (!earlier.length) return;
      setHistory((prev) => {
        const shown = new Set(prev.map((message) => message.id));
        return [...earlier.filter((message) => !shown.has(message.id)), ...prev];
      });
    }).catch(() => setHistoryNote(true));
  }
  // Earlier messages couldn't be shown safely. The current turn is unaffected.
  const [historyNote, setHistoryNote] = useState(false);

  function retryLast() {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.text, lastUser.visualContext);
  }

  async function send(text: string, explicitVisualContext?: VisualMessageContext) {
    const visualContext = explicitVisualContext ?? attachedVisualContext ?? undefined;
    const optimisticId = `u-${Date.now()}`;
    setHistory((prev) => [...prev, {
      role: "user",
      text,
      id: optimisticId,
      createdAt: Date.now(),
      ...(visualContext ? { visualContext } : {}),
    }]);
    setPending(true); // optimistic — same frame as send, before the awaited POST
    // While a reopened conversation is still loading, the requested id is
    // already canonical; never let a quick send turn it into a new conversation.
    const current = sessionId ?? requestedSessionId;
    // Talk with nothing remembered lets the server's resolver choose (I1
    // `continue`); only an explicit New topic mints a new-conversation key.
    const continuing = !current && continueLatest;
    if (!current && !continuing && !newConversationKeyRef.current) newConversationKeyRef.current = mintBindingRequestId();
    try {
      const r = await api.sendMessage(current, text, {
        visualContext,
        conversationIntent: current ? "resume" : continuing ? "continue" : "new",
        ...(current || continuing ? {} : { bindingRequestId: newConversationKeyRef.current! }),
      });
      if (unmountedRef.current) return;
      const bound = r.binding?.sessionId ?? r.sessionId;
      newConversationKeyRef.current = null;
      sessionIdRef.current = bound;
      setSessionId(bound);
      if (continuing && r.binding?.resolution === "continued") hydrateContinued(bound, r.userMessageId);
      if (r.binding?.origin) setOrigin(r.binding.origin);
      onSessionChange?.(bound);
      // A reply is the real answer to an idea: the server records it as engaged.
      if (inviteRef.current?.unreplied) {
        setInvite({ ...inviteRef.current, unreplied: false });
        onInitiativeChange?.();
      }
      setTaskId(r.taskId ?? null);
      setRunEpoch((n) => n + 1);
      if (visualContext && attachedVisualContext === visualContext) setAttachedVisualContext(null);
    } catch (e) {
      if (unmountedRef.current) return;
      if (isSessionUnavailable(e)) {
        // The conversation is gone: give the words back instead of losing them,
        // and let Nika choose where they go.
        setPending(false);
        setHistory((prev) => prev.filter((message) => message.id !== optimisticId));
        onDraft?.(text);
        setUnavailable(true);
        if (current) onSessionUnavailable?.(current);
        return;
      }
      // A failed POST (401 / offline / 5xx / 409) must NOT strand the chat: drop
      // the optimistic thinking flag (no events will ever arrive to clear it) and
      // append a visible assistant error bubble. It becomes the last assistant
      // message, so MessageActions offers Retry (retryLast re-sends this turn).
      // 401 is centrally handled in api.ts (clearToken + ava:unauthorized).
      setPending(false);
      const is401 = e instanceof ApiError && e.status === 401;
      const isMissingProvider =
        e instanceof ApiError &&
        e.status === 503 &&
        e.message === "no_llm_provider";
      setHistory((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: is401
            ? "Session expired — re-pair this device to continue."
            : isMissingProvider
              ? "AVA is running, but no AI provider is configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to AVA's .env file, then restart AVA."
              : e instanceof ApiError && e.code === "stale_visual_revision"
                ? "That visual changed before the context was sent. Reopen its newest revision and try again."
                : "That didn't send, Sir. Tap retry to try again.",
        },
      ]);
    }
  }

  function handleVisualSemanticAction(context: VisualMessageContext, visual: VisualMessage) {
    if (context.action === "attach") {
      setAttachedVisualContext(context);
      return;
    }
    const text = context.action === "branch"
      ? `Explain the selected branch of “${visual.title}” and what it means for the next decision.`
      : `Explain this scene of “${visual.title}” in more detail.`;
    void send(text, context);
  }

  // Command bar on home opens a fresh chat with text to send — fire it exactly
  // once, only for a brand-new session.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    const seedText = initialText?.trim();
    if (requestedSessionId === null && seedText) {
      autoSentRef.current = true;
      void send(seedText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId, initialText]);

  async function kill() {
    if (!sessionId) return;
    await api.killAll(sessionId);
  }

  // The bar keeps stable callbacks that always reach this screen's latest send,
  // stop and voice, so it is re-lent only when `busy` changes. Automated runs are
  // read-only: there the bar keeps starting new conversations.
  // Reopening a persisted chat hydrates its local state asynchronously. During
  // that window the requested ID is already canonical; voice must never turn
  // it into null and accidentally invoke fresh-voice policy.
  const latestRef = useRef({ send, kill, voice: () => onEnterVoice?.(sessionId ?? requestedSessionId) });
  latestRef.current = { send, kill, voice: () => onEnterVoice?.(sessionId ?? requestedSessionId) };
  const composer = useMemo<BarConversation>(() => ({
    onSend: (text) => { void latestRef.current.send(text); },
    onStop: () => { void latestRef.current.kill(); },
    onVoice: () => latestRef.current.voice(),
    busy,
  }), [busy]);
  // An idea that is still being checked, could not be checked, or matched
  // nothing never lends the bar: words typed there wait in the draft.
  const ideaUnverified = verifyInitiative && (ideaUnavailable || ideaState.status === "loading" || ideaState.status === "error");
  const lendComposer = !readOnly && !ideaUnverified;
  useEffect(() => {
    if (!lendComposer || !onComposer) return;
    onComposer(composer);
    return () => onComposer(null);
  }, [composer, lendComposer, onComposer]);

  return (
    <div className="ds-root ds-quiet-conversation relative flex h-full flex-col bg-canvas font-ui text-ink">
      <header
        className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-2"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        {/* One conversation (one-conversation v1): History browses the past;
            New topic is the only way to start fresh. */}
        <div className="justify-self-start">
          {onOpenList && (
            <Button variant="quiet" size="sm" onClick={onOpenList} leading={<History size={16} aria-hidden="true" />}>
              <span className="max-[380px]:sr-only">History</span>
            </Button>
          )}
        </div>
        <div className="flex items-center justify-center gap-2">
        <StatusIsland mode={island.mode} text={island.text} detail={island.detail} />
        {steps.length > 0 && (
          <Chip
            onClick={() => setStepsOpen(true)}
            aria-haspopup="dialog"
            aria-label={`Show what AVA did: ${steps.length} step${steps.length === 1 ? "" : "s"}`}
            leading={<ListChecks size={15} aria-hidden="true" />}
          >
            {steps.length}
          </Chip>
        )}
        {ideaState.status === "open" && ideaState.position && onOpenInvitation && (
          <InvitationNav position={ideaState.position} onOpen={onOpenInvitation} />
        )}
        </div>
        <div className="justify-self-end">
          {onNewChat && (
            <Button variant="quiet" size="sm" onClick={onNewChat} leading={<SquarePen size={16} aria-hidden="true" />}>
              <span className="max-[380px]:sr-only">New topic</span>
            </Button>
          )}
        </div>
      </header>
      <StepsSheet open={stepsOpen} onOpenChange={setStepsOpen} steps={steps} executing={executing} />

      <main className="relative flex min-h-0 flex-1 flex-col">
        {ideaUnavailable ? (
          <IdeaUnavailable onOpenList={onOpenList} onNewChat={onNewChat} />
        ) : ideaChecking ? (
          <div role="status" className="grid flex-1 place-items-center text-meta text-ink-3">Opening AVA's idea…</div>
        ) : verifyInitiative && ideaState.status === "error" ? (
          <div className="mx-auto grid w-full max-w-md flex-1 content-center px-6">
            <ErrorState title="Couldn't open this idea." body="Check your connection and try again." onRetry={invitation.retry} />
          </div>
        ) : unavailable ? (
          <div role="alert" className="mx-auto grid max-w-md flex-1 content-center justify-items-center gap-4 px-6 text-center">
            <p className="text-body-lg text-ink">This conversation is unavailable.</p>
            <p className="text-body text-ink-2">
              It may have been deleted. Your message is still in the box below; start a new
              conversation or pick one of yours.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {onNewChat && <Button variant="solid" onClick={onNewChat}>Start a new conversation</Button>}
              {onOpenList && <Button variant="glass" onClick={onOpenList}>Your conversations</Button>}
            </div>
          </div>
        ) : loadError ? (
          <div className="mx-auto grid w-full max-w-md flex-1 content-center px-6">
            <ErrorState
              title={loadError instanceof ApiError && loadError.status === 401
                ? "Session expired — re-pair this device to continue."
                : "Couldn't load this conversation."}
              body={loadError instanceof ApiError && loadError.status === 401 ? undefined : "Check your connection and try again."}
              onRetry={loadError instanceof ApiError && loadError.status === 401 ? undefined : () => setReloadNonce((n) => n + 1)}
            />
          </div>
        ) : isEmpty ? (
          <div className="ds-rise mx-auto grid flex-1 content-center justify-items-center gap-4 px-6 text-center">
            <FaceStill size={112} />
            {continueLatest && !sessionId ? (
              <>
                <h1 className="text-title text-ink">Pick up where you left off.</h1>
                <p className="max-w-xs text-body text-ink-2">Your next message continues your most recent conversation.</p>
              </>
            ) : (
              <>
                <h1 className="text-title text-ink">What's on your mind?</h1>
                <p className="max-w-xs text-body text-ink-2">Type below, pick a suggestion, or tap the mic to talk.</p>
              </>
            )}
          </div>
        ) : (
          <>
          {historyNote && sessionId && (
            <div role="status" className="mx-auto flex w-full max-w-[720px] flex-wrap items-center justify-between gap-3 px-4 pt-3 text-meta text-ink-2">
              <span>Earlier messages in this conversation couldn't be shown safely. Your message and AVA's reply are fine.</span>
              <Button variant="quiet" size="sm" onClick={() => { setHistoryNote(false); onOpenChat?.(sessionId); }}>Reload conversation</Button>
            </div>
          )}
          <MessageList
            history={history}
            liveEvents={liveEvents}
            onRetry={retryLast}
            onOpenSaved={onOpenSaved}
            scrollerRef={scrollerRef}
            optimisticThinking={optimisticThinking}
            executing={executing}
            runningTool={runningTool}
            headerState={headerState}
            onVisualSemanticAction={handleVisualSemanticAction}
          />
          </>
        )}
      </main>
        {/* The message box is the app's bottom bar; this keeps the last lines,
            the notes and the suggestions clear of it, however tall it grows. */}
        <div
          className="mx-auto grid w-full max-w-[720px] gap-2 px-3 pt-2"
          style={{ paddingBottom: "calc(var(--ds-bar-space, 72px) + env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        >
          {attachedVisualContext && (
            <div className="flex items-center justify-between gap-3 rounded-card bg-info-soft px-4 py-2.5 text-meta text-ink" role="status">
              <span>Selected visual context attached · revision {attachedVisualContext.revision} · {attachedVisualContext.selectedElementIds.length} element{attachedVisualContext.selectedElementIds.length === 1 ? "" : "s"}</span>
              <Button variant="quiet" size="sm" onClick={() => setAttachedVisualContext(null)} aria-label="Remove attached visual context">Remove</Button>
            </div>
          )}
          {!readOnly && !ideaUnavailable && (ideaState.status === "open" || ideaState.status === "closed") ? (
            <InvitationPanel
              state={ideaState}
              notice={invitation.notice}
              busy={invitation.busy}
              onTalk={() => onFocusComposer?.()}
              onLater={() => { void invitation.later(); }}
              onNotUseful={() => { void invitation.notUseful(); }}
              onOpenNote={onOpenNote}
              onOpenCalendarAt={onOpenCalendarAt}
            />
          ) : readOnly ? (
            <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-glass px-4 py-3 text-meta text-ink-2">
              <span>This is an automated run AVA did on its own, shown for reference. It never becomes your current chat. Anything you type below starts a new conversation.</span>
              {onNewChat && <Button variant="glass" size="sm" onClick={onNewChat}>Start a new conversation</Button>}
            </div>
          ) : chips.length > 0 && (
            <div role="group" aria-label="Suggestions" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {chips.map((chip) => (
                <Chip key={chip.id} title={chip.prompt} onClick={() => onDraft?.(chip.prompt)} className="shrink-0">
                  {chip.label}
                </Chip>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
