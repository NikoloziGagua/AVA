import { useCallback, useEffect, useState } from "react";
import { ApiError, deletePlaybook, fetchPeople, fetchPlaybooks, type PersonRow, type PlaybookRow } from "../api.js";
import { calendarDay } from "./memoryTime.js";

/** A live media query. jsdom has no matchMedia, so tests get the wide layout. */
export function useMedia(query: string): boolean {
  const read = () => { try { return window.matchMedia(query).matches; } catch { return false; } };
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    let list: MediaQueryList;
    try { list = window.matchMedia(query); } catch { return; }
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

const usage = (row: PlaybookRow) => `used ${row.uses} ${row.uses === 1 ? "time" : "times"}${row.last_used ? ` · last ${calendarDay(row.last_used)}` : ""}`;

/** What AVA learned to do from Niko's requests. It stops using one that keeps failing; Niko can forget any. */
export function HowTos({ compact, onNotice }: { compact: boolean; onNotice: (text: string, error?: boolean) => void }) {
  const [rows, setRows] = useState<PlaybookRow[] | null>(null), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await fetchPlaybooks()); setError(null); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : "The how-tos couldn’t be loaded. Try again."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const used = rows?.filter((row) => row.offered !== false) ?? [], retired = rows?.filter((row) => row.offered === false) ?? [];
  const current = rows?.find((row) => row.slug === selected) ?? (compact ? null : used[0] ?? retired[0] ?? null);
  const forget = async (row: PlaybookRow) => {
    setBusy(true);
    try { await deletePlaybook(row.slug); onNotice(`Forgot how to “${row.trigger}”.`); setSelected(null); setConfirming(false); await load(); }
    catch (failure) { onNotice(failure instanceof ApiError ? failure.message : "That how-to couldn’t be forgotten. Try again.", true); }
    finally { setBusy(false); }
  };
  const body = (row: PlaybookRow) => <div className="ds-memory-body">
    <p className="ds-memory-meta">{usage(row)}{row.offered === false ? " · no longer used" : ""}</p>
    <p className="ds-memory-kicker">Steps</p>
    <ol className="ds-memory-steps">{row.steps.map((step, at) => <li key={at}>{step}</li>)}</ol>
    {row.lessons.length > 0 && <><p className="ds-memory-kicker">What I learned doing it</p><ul className="ds-memory-steps">{row.lessons.map((lesson, at) => <li key={at}>{lesson}</li>)}</ul></>}
    {confirming ? <div className="ds-memory-confirm" role="group" aria-label="Confirm forget">
      <p>Forget this how-to? I’ll work it out again the next time you ask.</p>
      <div className="ds-memory-actions">
        <button className="ds-focus ds-memory-button" data-tone="danger" disabled={busy} onClick={() => void forget(row)}>{busy ? "Working…" : "Forget"}</button>
        <button className="ds-focus ds-memory-button" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
      </div>
    </div> : <div className="ds-memory-actions"><button className="ds-focus ds-memory-button" data-tone="danger" onClick={() => setConfirming(true)}>Forget this how-to</button></div>}
  </div>;
  const list = (items: PlaybookRow[], quiet: boolean) => <ul>{items.map((row) => {
    const on = row.slug === current?.slug;
    return <li key={row.slug} className="ds-memory-item" data-selected={on} data-quiet={quiet}>
      <button className="ds-focus ds-memory-row" aria-pressed={on} onClick={() => { setSelected(compact && on ? null : row.slug); setConfirming(false); }}>
        <span className="ds-memory-text">{row.trigger}</span><span className="ds-memory-meta">{usage(row)}</span>
      </button>
      {compact && on && <div className="ds-memory-inline">{body(row)}</div>}
    </li>;
  })}</ul>;
  return <>
    <section className="ds-memory-list" aria-label="Learned how-tos">
      <h2>Learned how-tos</h2>
      <p className="ds-memory-hint">Ways of doing things I learned from what you asked me to do. I reuse them to be quicker.</p>
      {error && <p role="alert" className="ds-memory-empty">{error}</p>}
      {!rows && !error && <p role="status" className="ds-memory-empty">Loading…</p>}
      {rows && !rows.length && <p className="ds-memory-empty">Nothing learned yet.</p>}
      {list(used, false)}
      {retired.length > 0 && <><h3 className="ds-memory-subhead">No longer used</h3><p className="ds-memory-hint">These kept failing, so I stopped using them.</p>{list(retired, true)}</>}
    </section>
    {!compact && <aside className="ds-memory-detail" aria-label="Selected how-to">
      {current && <><p className="ds-memory-kicker">How-to</p><p className="ds-memory-big">{current.trigger}</p>{body(current)}</>}
    </aside>}
  </>;
}

const apps = (person: PersonRow) => [
  person.instagram?.username ? `Instagram @${person.instagram.username}` : "",
  person.whatsapp?.username || person.whatsapp?.phone ? "WhatsApp" : "",
].filter(Boolean).join(" · ");

/** Who AVA can reach for Niko and the names he uses for them. Grown by talking, so read-only here. */
export function Contacts({ compact }: { compact: boolean }) {
  const [rows, setRows] = useState<PersonRow[] | null>(null), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchPeople().then((people) => { if (alive) setRows(people); })
      .catch((failure) => { if (alive) setError(failure instanceof ApiError ? failure.message : "Contacts couldn’t be loaded. Try again."); });
    return () => { alive = false; };
  }, []);
  const current = rows?.find((person) => person.id === selected) ?? (compact ? null : rows?.[0] ?? null);
  const body = (person: PersonRow) => <div className="ds-memory-body">
    {person.aliases.length > 0 && <p className="ds-memory-meta">You also call them {person.aliases.join(", ")}.</p>}
    {person.instagram?.username && <p className="ds-memory-quote">Instagram @{person.instagram.username}{person.instagram.threadId ? " · I’ve opened this chat before" : ""}</p>}
    {(person.whatsapp?.username || person.whatsapp?.phone) && <p className="ds-memory-quote">WhatsApp {person.whatsapp.username ?? person.whatsapp.phone}</p>}
    {person.notes && <p className="ds-memory-meta">{person.notes}</p>}
    <p className="ds-memory-meta">Updated {calendarDay(person.updated)}</p>
  </div>;
  return <>
    <section className="ds-memory-list" aria-label="Contacts">
      <h2>Contacts</h2>
      <p className="ds-memory-hint">Who I can message for you, and the names you use for them. Tell me about someone and I’ll add them.</p>
      {error && <p role="alert" className="ds-memory-empty">{error}</p>}
      {!rows && !error && <p role="status" className="ds-memory-empty">Loading…</p>}
      {rows && !rows.length && <p className="ds-memory-empty">No contacts yet.</p>}
      <ul>{rows?.map((person) => {
        const on = person.id === current?.id;
        return <li key={person.id} className="ds-memory-item" data-selected={on}>
          <button className="ds-focus ds-memory-row" aria-pressed={on} onClick={() => setSelected(compact && on ? null : person.id)}>
            <span className="ds-memory-text">{person.name}</span><span className="ds-memory-meta">{apps(person) || "No apps yet"}</span>
          </button>
          {compact && on && <div className="ds-memory-inline">{body(person)}</div>}
        </li>;
      })}</ul>
    </section>
    {!compact && <aside className="ds-memory-detail" aria-label="Selected contact">
      {current && <><p className="ds-memory-kicker">Contact</p><p className="ds-memory-big">{current.name}</p>{body(current)}</>}
    </aside>}
  </>;
}
