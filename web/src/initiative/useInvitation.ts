import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchInboxSessions,
  fetchInitiative,
  isInitiativeUnavailable,
  markInitiativeOpened,
  setInitiativeDisposition,
  type InitiativeView,
} from "./api.js";

/** A neighbouring invitation in AVA's inbox, newest first. */
export type InvitationRef = { sessionId: string; initiativeId: string };

export type InvitationPosition = {
  /** 1-based, newest first: "Idea 2 of 3". */
  index: number;
  total: number;
  newer: InvitationRef | null;
  older: InvitationRef | null;
};

export type InvitationState =
  /** Not an invitation, or one Niko has already answered in the conversation. */
  | { status: "none" }
  | { status: "loading" }
  /** The link's pair does not match one idea: shown in place, naming no IDs. */
  | { status: "unavailable" }
  | { status: "error" }
  /** Still waiting for Niko: the actions and the sources are offered. */
  | { status: "open"; view: InitiativeView; position: InvitationPosition | null }
  /** Reachable but finished: expired or marked not useful. */
  | { status: "closed"; view: InitiativeView; reason: "expired" | "not_useful" };

export type InvitationInput = {
  /** The conversation on screen. */
  sessionId: string | null;
  /** From the session row, or from whatever opened it (a link, the newest idea). */
  initiativeId: string | null;
  /** The conversation is AVA's and has no accepted reply from Niko yet. */
  unreplied: boolean;
  /** Opened as an idea (link, bar or navigation): the pair must match one idea. */
  verify: boolean;
  /** Something changed that the bar's count should reflect. */
  onChange?: () => void;
  now?: () => number;
};

function positionIn(rows: Array<{ id: string; initiativeId?: string | null }>, sessionId: string): InvitationPosition | null {
  const at = rows.findIndex((row) => row.id === sessionId);
  if (at < 0 || rows.length < 2) return null;
  const ref = (row: { id: string; initiativeId?: string | null } | undefined): InvitationRef | null =>
    row && row.initiativeId ? { sessionId: row.id, initiativeId: row.initiativeId } : null;
  return { index: at + 1, total: rows.length, newer: ref(rows[at - 1]), older: ref(rows[at + 1]) };
}

/**
 * One invitation's state and its two answers (contract ava-initiative):
 * Later keeps it in the inbox without a second push; Not useful dismisses it.
 * Opening marks it seen, which is not engagement. A reply is engagement and
 * is recorded by the server, not here.
 */
export function useInvitation(input: InvitationInput) {
  const { sessionId, initiativeId, unreplied, verify } = input;
  const onChangeRef = useRef(input.onChange);
  onChangeRef.current = input.onChange;
  const nowRef = useRef(input.now ?? Date.now);
  nowRef.current = input.now ?? Date.now;
  const [state, setState] = useState<InvitationState>({ status: verify ? "loading" : "none" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((value) => value + 1), []);
  // The pair already confirmed to match: a reply then only hides the answers,
  // without re-checking (which would blank the conversation mid-reply).
  const verified = useRef<string | null>(null);
  // Advances when a different idea is committed to the screen, so an answer
  // still in flight for the previous one can never touch this one's panel,
  // even after a round trip back to the same pair. It moves in a layout
  // effect, not during render: a render React discards never counts, and no
  // promise can resolve between a commit and its layout effects.
  const epoch = useRef(0);
  useLayoutEffect(() => { epoch.current += 1; }, [sessionId, initiativeId]);
  // The state last committed to the screen, for completions to compare against.
  const committed = useRef(state);
  useLayoutEffect(() => { committed.current = state; });

  // A notice and a pending answer belong to one idea; a reload after a stale
  // answer keeps the notice.
  useEffect(() => { setNotice(null); setBusy(false); }, [sessionId, initiativeId]);

  useEffect(() => {
    let cancelled = false;
    // Until the conversation itself has loaded, a link stays "checking" so its
    // transcript never flashes before the pair is known to match.
    if (!sessionId) { setState({ status: verify ? "loading" : "none" }); return; }
    if (!initiativeId) { setState({ status: verify ? "unavailable" : "none" }); return; }
    const pair = `${sessionId}\n${initiativeId}`;
    if (!unreplied && (!verify || verified.current === pair)) { setState({ status: "none" }); return; }
    setState({ status: "loading" });
    void (async () => {
      let view: InitiativeView;
      try {
        view = await fetchInitiative(initiativeId);
      } catch (error) {
        if (!cancelled) setState({ status: isInitiativeUnavailable(error) && verify ? "unavailable" : isInitiativeUnavailable(error) ? "none" : "error" });
        return;
      }
      if (cancelled) return;
      if (view.sessionId !== sessionId) { setState({ status: verify ? "unavailable" : "none" }); return; }
      verified.current = pair;
      if (!unreplied || view.disposition.state === "engaged") { setState({ status: "none" }); return; }
      if (view.disposition.state === "not_useful") { setState({ status: "closed", view, reason: "not_useful" }); return; }
      if (view.expiresAt <= nowRef.current()) { setState({ status: "closed", view, reason: "expired" }); return; }
      setState({ status: "open", view, position: null });
      if (view.openedAt === null) {
        markInitiativeOpened(view.id).then(() => onChangeRef.current?.()).catch(() => { /* seen is best-effort */ });
      }
      try {
        const rows = await fetchInboxSessions();
        if (!cancelled) {
          setState((current) => current.status === "open" && current.view.id === view.id
            ? { ...current, position: positionIn(rows, sessionId) }
            : current);
        }
      } catch { /* without the inbox there is simply no "Idea N of M" */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId, initiativeId, unreplied, verify, reload]);

  const answer = useCallback(async (choice: "later" | "not_useful") => {
    if (state.status !== "open" || busy) return;
    const { view } = state;
    // Every completion below applies only while this same idea is on screen,
    // and only onto the exact version it answered: a newer read (a reload
    // after a change elsewhere) is never overwritten by an older answer.
    const mine = epoch.current;
    const basedOn = view.disposition.version;
    const sameIdea = (current: InvitationState) =>
      (current.status === "open" || current.status === "closed")
      && current.view.id === view.id && current.view.disposition.version === basedOn;
    // Still this idea on screen, still showing the version this answer was about.
    const current = () => epoch.current === mine && sameIdea(committed.current);
    setBusy(true);
    setNotice(null);
    try {
      const result = await setInitiativeDisposition(view.id, choice, basedOn);
      // The server's state changed, so the bar's count may refresh wherever Niko is now.
      if (result.ok) onChangeRef.current?.();
      if (!current()) return;
      if (!result.ok) {
        setNotice("This idea changed on another device. Here is where it stands now.");
        retry();
        return;
      }
      const next = { ...view, disposition: result.disposition };
      if (choice === "not_useful") {
        setState((latest) => sameIdea(latest) ? { status: "closed", view: next, reason: "not_useful" } : latest);
        setNotice("Marked not useful. AVA will take that into account.");
      } else {
        setState((latest) => latest.status === "open" && sameIdea(latest) ? { ...latest, view: next } : latest);
        setNotice("Saved for later. It stays in your ideas for up to three days.");
      }
    } catch (error) {
      if (!current()) return;
      if (isInitiativeUnavailable(error)) setState((latest) => sameIdea(latest) ? { status: "unavailable" } : latest);
      else setNotice("That didn't save. Check the connection and try again.");
    } finally {
      // Busy belongs to this idea: moving to another one already cleared it.
      if (epoch.current === mine) setBusy(false);
    }
  }, [busy, retry, state]);

  return {
    state,
    notice,
    busy,
    retry,
    later: () => answer("later"),
    notUseful: () => answer("not_useful"),
  };
}
