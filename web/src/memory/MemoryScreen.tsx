import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { ApiError } from "../api.js";
import {
  confirmMemory, correctMemory, fetchMemoryDetail, fetchMemoryOverview, forgetMemory, memoryFailure, searchMemory, setMemoryCarry,
  type MemoryDetail, type MemoryEvent, type MemoryItem, type MemoryKind, type MemoryOverview,
} from "./archive-api.js";
import { Contacts, HowTos, useMedia } from "./MemoryExtras.js";
import { day, moment } from "./memoryTime.js";

const MemoryMap = lazy(async () => ({ default: (await import("./MemoryMap.js")).MemoryMap }));

type SectionId = "about" | "people" | "projects" | "rules" | "waiting" | "history";
type ExtraId = "howtos" | "contacts" | "map";
type View = SectionId | ExtraId;
type Mode = { id: string; kind: "edit" | "confirm" } | null;

const SECTIONS: Array<{ id: SectionId; label: string; short: string; hint: string; empty: string }> = [
  { id: "about", label: "About you", short: "About you", hint: "Facts about your life, each with when you said it.", empty: "Nothing here yet. Tell me about yourself and I’ll remember it." },
  { id: "people", label: "People", short: "People", hint: "The people in your life.", empty: "No one yet. Tell me about the people in your life." },
  { id: "projects", label: "Projects and focus", short: "Projects", hint: "What you’re working on and what matters most right now.", empty: "No projects yet." },
  { id: "rules", label: "Your rules", short: "Rules", hint: "Your standing rules for how I should do things.", empty: "No rules yet. Tell me how you want things done." },
  { id: "waiting", label: "Waiting for you", short: "Waiting", hint: "Things I noticed but won’t keep until you say so.", empty: "Nothing waiting. When I hear something private, or I’m not sure I understood, it waits here until you say Keep or Drop." },
  { id: "history", label: "History", short: "History", hint: "Older versions. I keep them so I never mistake them for current.", empty: "No older versions yet." },
];
const EXTRAS: Array<{ id: ExtraId; label: string }> = [{ id: "howtos", label: "Learned how-tos" }, { id: "contacts", label: "Contacts" }, { id: "map", label: "Map" }];
const KIND_SECTION: Record<MemoryKind, SectionId> = { fact: "about", event: "about", person: "people", project: "projects", decision: "projects", commitment: "projects", preference: "rules" };
const sectionOf = (item: MemoryItem): SectionId => item.status === "unconfirmed" ? "waiting" : item.status === "history" ? "history" : KIND_SECTION[item.kind];
const isSection = (view: View): view is SectionId => SECTIONS.some((section) => section.id === view);
const WHO: Record<MemoryItem["speechAct"], string> = { stated: "you said", decided: "you decided", requested: "you asked me to remember", discussed: "we discussed", inferred: "my guess" };
const who = (item: MemoryItem) => item.origin === "explicit" && !item.hasSources ? "you wrote" : WHO[item.speechAct];
const VERB: Record<MemoryEvent["action"], string> = { added: "Learned", updated: "Updated", ended: "No longer true", stopped_carrying: "Stopped bringing up", carried: "Bringing up again", confirmed: "You kept", forgotten: "Forgot" };

/** One forget erases every version of a memory; the feed shows it once. */
function feedEvents(events: MemoryEvent[]): MemoryEvent[] {
  return events.filter((event, at) => {
    const previous = events[at - 1];
    return !(event.action === "forgotten" && previous?.action === "forgotten" && Math.abs(previous.createdAt - event.createdAt) < 5_000);
  });
}

/** What AVA knows about Niko (memory v2): each memory with when he said it, where it came from, and his controls. */
export function MemoryScreen({ onOpenChat }: { onClose?: () => void; onOpenChat?: (sessionId: string) => void }) {
  const narrow = useMedia("(max-width: 1180px)"), compact = useMedia("(max-width: 860px)");
  const [data, setData] = useState<MemoryOverview | null>(null), [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("about"), [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState(""), [hits, setHits] = useState<MemoryItem[] | null>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null), [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const generation = useRef(0), holding = useRef(false);
  holding.current = mode !== null || busy;

  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await fetchMemoryOverview();
      if (current === generation.current) { setData(next); setLoadError(null); }
    } catch (failure) {
      if (current === generation.current) setLoadError(failure instanceof ApiError ? failure.message : "Memory couldn’t be loaded. Try again.");
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Pick up what AVA learned while this screen was in the background, never mid-edit.
  useEffect(() => {
    const focus = () => { if (!document.hidden && !holding.current) void reload(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [reload]);

  const searching = query.trim().length > 0;
  useEffect(() => {
    const text = query.trim();
    setHits(null);
    if (!text) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      searchMemory(text).then((found) => { if (alive) setHits(found); }).catch(() => { if (alive) setHits([]); });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, data]);

  const bySection = useMemo(() => {
    const map = new Map<SectionId, MemoryItem[]>(SECTIONS.map((section) => [section.id, []]));
    for (const item of data?.records ?? []) map.get(sectionOf(item))!.push(item);
    map.set("history", data?.history ?? []);
    return map;
  }, [data]);
  const known = useMemo(() => new Map([...(data?.records ?? []), ...(data?.history ?? [])].map((item) => [item.id, item])), [data]);
  const items = searching ? hits ?? [] : isSection(view) ? bySection.get(view)! : [];
  // Wide screens always show one memory in the detail pane; phones open one in place when tapped.
  const selected = items.find((item) => item.id === selectedId) ?? (compact || (!searching && !isSection(view)) ? null : items[0] ?? null);
  const selectedKey = selected ? `${selected.id}:${selected.version}` : "";

  useEffect(() => {
    setDetail(null);
    if (!selectedKey) return;
    let alive = true;
    fetchMemoryDetail(selectedKey.split(":")[0]!).then((next) => { if (alive) setDetail(next); }).catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [selectedKey]);

  const go = (next: View) => { setView(next); setSelectedId(null); setMode(null); setQuery(""); };
  const open = (id: string) => {
    const item = known.get(id);
    if (item) { setQuery(""); setView(sectionOf(item)); setSelectedId(id); setMode(null); }
  };
  async function change(run: () => Promise<{ text: string; select?: string | null }>) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const done = await run();
      setMode(null);
      if (done.select !== undefined) setSelectedId(done.select);
      setNotice({ text: done.text });
    } catch (failure) {
      const { message, reload: stale } = memoryFailure(failure);
      if (stale) setMode(null);
      setNotice({ text: message, error: true });
    } finally {
      setBusy(false);
      await reload();
    }
  }
  const actions = (item: MemoryItem) => ({
    fix: (text: string) => void change(async () => ({ text: "Saved. I’ll use this from now on.", select: (await correctMemory(item, text)).id })),
    carry: (carry: boolean) => void change(async () => {
      await setMemoryCarry(item, carry);
      return { text: carry ? "Back in everyday memory." : "Kept, but I’ll only use it when you ask." };
    }),
    keep: () => void change(async () => {
      const kept = await confirmMemory(item);
      return { text: `Kept. It’s in ${SECTIONS.find((section) => section.id === sectionOf(kept))!.label} now.`, select: null };
    }),
    forget: () => void change(async () => {
      await forgetMemory(item);
      return { text: item.status === "unconfirmed" ? "Dropped. I won’t keep it." : "Forgotten, along with the lines it came from.", select: null };
    }),
  });

  const section = isSection(view) ? SECTIONS.find((entry) => entry.id === view)! : null;
  const count = (id: SectionId) => bySection.get(id)!.length;
  const title = searching ? `Results for “${query.trim()}”` : section?.label ?? "";
  const hint = searching ? hits ? `${hits.length} found, including older versions.` : "Searching…" : section?.hint ?? "";
  const detailFor = (item: MemoryItem) => <Detail key={`${item.id}:${item.version}`} item={item} detail={detail?.record.id === item.id ? detail : null}
    busy={busy} mode={mode?.id === item.id ? mode.kind : "view"} setMode={(kind) => setMode(kind === "view" ? null : { id: item.id, kind })}
    actions={actions(item)} onOpenChat={onOpenChat} />;
  const feed = (limit: number) => <Feed events={data?.events ?? []} limit={limit} known={known} onOpen={open} />;
  const extra = !searching && !isSection(view) ? view : null;

  return <section aria-label="Memory" className="ds-root ds-memory h-full overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="nocturne" />
    <div className="ds-memory-content">
      <header className="ds-memory-header">
        <div><h1>Memory</h1><p>{data ? `${data.counts.active} ${data.counts.active === 1 ? "thing" : "things"} I know about you, from what you told me.` : "Loading what I know…"}</p></div>
        <label className="ds-memory-search"><Search size={16} aria-hidden />
          <input type="search" value={query} placeholder="Search what AVA remembers" aria-label="Search what AVA remembers"
            onChange={(event) => { setQuery(event.target.value); setSelectedId(null); setMode(null); }}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} />
        </label>
      </header>
      {data && !data.enabled && <p role="status" className="ds-memory-banner">The new memory is switched off, so I’m not using these right now.</p>}
      {loadError && <div role="alert" className="ds-memory-banner"><span>{loadError}</span><button className="ds-focus ds-memory-button" onClick={() => void reload()}>Try again</button></div>}
      <p className="ds-memory-notice" role={notice?.error ? "alert" : "status"} data-error={notice?.error ?? false}>{notice?.text}</p>
      {compact && data && <div className="ds-memory-justnow">{feed(2)}</div>}
      {narrow && <nav className="ds-memory-chips" aria-label="Memory sections">
        {SECTIONS.map((entry) => <button key={entry.id} className="ds-focus" aria-label={`${entry.label}, ${count(entry.id)}`} aria-pressed={!searching && view === entry.id} onClick={() => go(entry.id)}>{entry.short}<span>{count(entry.id)}</span></button>)}
        {EXTRAS.map((entry) => <button key={entry.id} className="ds-focus" aria-pressed={!searching && view === entry.id} onClick={() => go(entry.id)}>{entry.label}</button>)}
      </nav>}
      <div className="ds-memory-panel" aria-busy={!data}>
        {!narrow && <nav className="ds-memory-rail" aria-label="Memory sections">
          {SECTIONS.map((entry) => <button key={entry.id} className="ds-focus" aria-label={`${entry.label}, ${count(entry.id)}`} aria-pressed={!searching && view === entry.id} onClick={() => go(entry.id)}>{entry.label}<span>{count(entry.id)}</span></button>)}
          <p className="ds-memory-rail-label">ALSO IN MEMORY</p>
          {EXTRAS.map((entry) => <button key={entry.id} className="ds-focus" aria-pressed={!searching && view === entry.id} onClick={() => go(entry.id)}>{entry.label}</button>)}
          <p className="ds-memory-rail-note">Or just tell me: “that’s wrong”, “stop bringing that up”, “forget that”. It changes straight away.</p>
        </nav>}
        {extra === "howtos" ? <HowTos compact={compact} onNotice={(text, error) => setNotice({ text, error })} />
          : extra === "contacts" ? <Contacts compact={compact} />
          : extra === "map" ? <Suspense fallback={<p role="status" className="ds-memory-map ds-memory-hint">Drawing the map…</p>}><MemoryMap records={data?.records ?? []} /></Suspense>
          : <>
            <section className="ds-memory-list" aria-label={title}>
              <h2>{title}</h2>
              <p className="ds-memory-hint">{hint}</p>
              {data && !items.length && (!searching || hits) && <p className="ds-memory-empty">{searching ? "Nothing about that in my memory. Ask me by voice and I’ll look through our past conversations too." : section?.empty}</p>}
              <ul>{items.map((item) => {
                const on = item.id === selected?.id;
                return <li key={item.id} className="ds-memory-item" data-selected={on} data-quiet={item.status === "history"}>
                  <button className="ds-focus ds-memory-row" aria-pressed={on} onClick={() => { setSelectedId(compact && on ? null : item.id); setMode(null); }}>
                    <span className="ds-memory-text">{item.text}</span>
                    <span className="ds-memory-meta">{item.status === "history" ? `until ${item.validTo ? day(item.validTo) : "replaced"}` : `${who(item)} · ${day(item.saidAt)}`}
                      {item.sensitive && <span className="ds-memory-tag">private</span>}
                      {searching && item.status === "history" && <span className="ds-memory-tag" data-tone="quiet">old</span>}
                      {searching && item.status === "unconfirmed" && <span className="ds-memory-tag" data-tone="quiet">waiting</span>}
                      {item.status === "active" && !item.carry && <span className="ds-memory-tag" data-tone="quiet">only when asked</span>}
                    </span>
                  </button>
                  {compact && on && <div className="ds-memory-inline">{detailFor(item)}</div>}
                </li>;
              })}</ul>
            </section>
            {!compact && <aside className="ds-memory-detail" aria-label="Selected memory">
              {selected && <>
                <p className="ds-memory-kicker">{selected.status === "history" ? "Older version" : selected.status === "unconfirmed" ? "Waiting for you" : "Selected"}</p>
                <p className="ds-memory-big">{selected.text}</p>
                <p className="ds-memory-meta">{who(selected)} · {day(selected.saidAt)}</p>
                {detailFor(selected)}
              </>}
              {feed(5)}
            </aside>}
          </>}
      </div>
    </div>
  </section>;
}

type Actions = { fix: (text: string) => void; carry: (carry: boolean) => void; keep: () => void; forget: () => void };

/** Provenance, status and Niko's controls for one memory. Keyed by version, so a draft never outlives the text it edits. */
function Detail({ item, detail, busy, mode, setMode, actions, onOpenChat }: {
  item: MemoryItem; detail: MemoryDetail | null; busy: boolean; mode: "view" | "edit" | "confirm";
  setMode: (mode: "view" | "edit" | "confirm") => void; actions: Actions; onOpenChat?: (sessionId: string) => void;
}) {
  const [draft, setDraft] = useState(item.text);
  const waiting = item.status === "unconfirmed", history = item.status === "history";
  const chain = detail?.chain ?? [];
  const replacedBy = history ? chain.find((version) => version.id === item.supersededById) : undefined;
  const before = chain.filter((version) => version.status === "history" && version.id !== item.supersededById && version.saidAt <= item.saidAt)
    .sort((a, b) => b.saidAt - a.saidAt);
  const text = draft.trim();
  return <div className="ds-memory-body">
    {item.status === "active" && <p className="ds-memory-status" data-carry={item.carry}><strong>{item.carry ? "Always in mind." : "Only when you ask."}</strong> {item.carry ? "I use this in every conversation." : "I keep it, but won’t bring it up myself."}</p>}
    {waiting && <p className="ds-memory-status" data-carry="false"><strong>Not kept yet.</strong> I won’t use this until you say Keep.</p>}
    {history && <p className="ds-memory-status">True until {item.validTo ? day(item.validTo) : "it was replaced"}.{!item.supersededById && " Nothing replaced it."}</p>}
    {replacedBy && <><p className="ds-memory-kicker">Replaced by</p><p className="ds-memory-quote">{replacedBy.text}</p></>}
    <p className="ds-memory-kicker">Where this came from</p>
    {!detail ? <p role="status" className="ds-memory-meta">Finding the conversation…</p>
      : detail.sources.length ? detail.sources.map((source) => <div key={source.id} className="ds-memory-quote">
        <p><strong>{source.speaker === "niko" ? "You" : "AVA"}, {moment(source.at)}:</strong> “{source.text}”</p>
        {onOpenChat && <button className="ds-focus ds-memory-link" onClick={() => onOpenChat(source.sessionId)}>Open conversation</button>}
      </div>)
      : <p className="ds-memory-meta">{item.origin === "explicit" ? "You wrote this yourself." : item.origin === "migration" ? "Carried over from my older memory." : "The conversation it came from isn’t available any more."}</p>}
    {before.length > 0 && <><p className="ds-memory-kicker">Before</p>
      <ul className="ds-memory-past">{before.map((version) => <li key={version.id}>Until {version.validTo ? day(version.validTo) : "replaced"}: {version.text}</li>)}</ul></>}
    {mode === "edit" ? <form className="ds-memory-form" onSubmit={(event) => { event.preventDefault(); if (text && text !== item.text) actions.fix(text); }}>
      <label className="ds-memory-kicker" htmlFor={`fix-${item.id}`}>Fix what I remember</label>
      <textarea id={`fix-${item.id}`} className="ds-focus ds-memory-edit" value={draft} maxLength={600} autoFocus onChange={(event) => setDraft(event.target.value)} />
      <div className="ds-memory-actions">
        <button type="submit" className="ds-focus ds-memory-button" data-tone="solid" disabled={busy || !text || text === item.text}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="ds-focus ds-memory-button" disabled={busy} onClick={() => setMode("view")}>Cancel</button>
      </div>
    </form>
      : mode === "confirm" ? <div className="ds-memory-confirm" role="group" aria-label={waiting ? "Confirm drop" : "Confirm forget"}>
        <p>{waiting ? "Drop this? I won’t keep it, or learn it again from the same lines." : "Forget this for good? I also forget the lines it came from, and won’t learn it again from them."}</p>
        <div className="ds-memory-actions">
          <button className="ds-focus ds-memory-button" data-tone="danger" disabled={busy} onClick={actions.forget}>{busy ? "Working…" : waiting ? "Drop" : "Forget"}</button>
          <button className="ds-focus ds-memory-button" disabled={busy} onClick={() => setMode("view")}>Keep it</button>
        </div>
      </div>
      : waiting ? <div className="ds-memory-actions">
        <button className="ds-focus ds-memory-button" data-tone="solid" disabled={busy} onClick={actions.keep}>Keep</button>
        <button className="ds-focus ds-memory-button" data-tone="danger" disabled={busy} onClick={() => setMode("confirm")}>Drop</button>
      </div>
      : item.status === "active" ? <div className="ds-memory-actions">
        <button className="ds-focus ds-memory-button" data-tone="solid" disabled={busy} onClick={() => setMode("edit")}>Fix</button>
        <button className="ds-focus ds-memory-button" disabled={busy} onClick={() => actions.carry(!item.carry)}>{item.carry ? "Stop bringing up" : "Bring it up again"}</button>
        <button className="ds-focus ds-memory-button" data-tone="danger" disabled={busy} onClick={() => setMode("confirm")}>Forget</button>
      </div>
      : null}
  </div>;
}

function Feed({ events, limit, known, onOpen }: { events: MemoryEvent[]; limit: number; known: Map<string, MemoryItem>; onOpen: (id: string) => void }) {
  const shown = feedEvents(events).slice(0, limit);
  return <section className="ds-memory-feed" aria-label="Just learned">
    <p className="ds-memory-kicker">Just learned</p>
    {shown.length ? <ul>{shown.map((event) => {
      const line = <><span>{event.summary ?? "Something you asked me to forget"}</span><small>{VERB[event.action]} · {moment(event.createdAt)}</small></>;
      return <li key={event.seq}>{event.summary && known.has(event.recordId)
        ? <button className="ds-focus" onClick={() => onOpen(event.recordId)}>{line}</button> : <p>{line}</p>}</li>;
    })}</ul> : <p className="ds-memory-meta">Nothing new yet.</p>}
  </section>;
}
