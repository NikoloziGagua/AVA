import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Sheet } from "../design/Sheet.js";
import { fetchNotesTree, type NoteFolder } from "../notes/api.js";
import { ApiError } from "../api.js";
import { saveCalendarEvent, updateOccurrence, type EventDefinition, type EventInput } from "./workspace-api.js";
import type { CalendarOccurrence } from "./api.js";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ds-calendar-field"><span>{label}</span>{children}</label>;
}
function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "This change could not be confirmed. Close and refresh before trying again.";
}

export function EventEditor({ date, base, onClose, onSaved }: {
  date: string; base?: EventDefinition; onClose: () => void; onSaved: (date: string) => void;
}) {
  const [draft, setDraft] = useState<EventInput>(() => base ? {
    title: base.title, description: base.description, location: base.location, kind: base.kind,
    timeZone: base.timeZone, anchorLocalDate: base.anchorLocalDate, startLocalTime: base.startLocalTime,
    durationMinutes: base.durationMinutes, recurrenceKind: base.recurrenceKind, recurrenceUntilDate: base.recurrenceUntilDate,
    dstPolicy: base.dstPolicy, attendanceIntent: base.attendanceIntent, notesFolderId: base.notesFolderId,
  } : { title: "", description: "", location: "", kind: "event", timeZone: "Europe/Dublin", anchorLocalDate: date,
    startLocalTime: "09:00:00", durationMinutes: 60, recurrenceKind: "none", recurrenceUntilDate: null, dstPolicy: "reject", attendanceIntent: "undecided", notesFolderId: null });
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [foldersAvailable, setFoldersAvailable] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [blocked, setBlocked] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    fetchNotesTree().then(tree => { if (alive) { setFolders(tree.folders); setFoldersAvailable(true); } }, () => {});
    return () => { alive = false; mounted.current = false; };
  }, []);
  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || blocked) return;
    if (!draft.title.trim()) { setError("Give this event a title."); return; }
    if (draft.recurrenceKind === "weekly" && (!draft.recurrenceUntilDate || draft.recurrenceUntilDate < draft.anchorLocalDate)) {
      setError("Choose a weekly end date on or after the first event."); return;
    }
    sending.current = true; setBusy(true); setError(null);
    try {
      const saved = await saveCalendarEvent({ ...draft, title: draft.title.trim(), recurrenceUntilDate: draft.recurrenceKind === "weekly" ? draft.recurrenceUntilDate : null }, base);
      if (mounted.current) onSaved(saved.anchorLocalDate);
    } catch (error) {
      if (!mounted.current) return;
      setError(errorText(error));
      // Known validation errors can be corrected. Stale/unknown outcomes require
      // a fresh authoritative read; no automatic or blind consequential retry.
      if (!(error instanceof ApiError) || error.status === 0 || error.status === 409 || error.status === 404 || error.status >= 500) setBlocked(true);
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Sheet open onOpenChange={open => { if (!open && !busy) onClose(); }} title={base ? "Edit event series" : "Make time for it."}
    description={base ? "Changes apply to the whole future series. Past history is never rewritten." : "An event, a lecture, or a little breathing room."} className="ds-calendar-editor">
    <form onSubmit={event => { void submit(event); }} className="ds-calendar-form">
      <Field label="Title"><input autoFocus required maxLength={160} value={draft.title} onChange={e => set("title", e.target.value)} placeholder="What is happening?" className="ds-calendar-title-input" /></Field>
      <div className="ds-calendar-field-pair">
        <Field label="Date"><input type="date" required value={draft.anchorLocalDate} onChange={e => set("anchorLocalDate", e.target.value)} /></Field>
        <Field label="Starts"><input type="time" required value={draft.startLocalTime.slice(0, 5)} onChange={e => set("startLocalTime", `${e.target.value}:00`)} /></Field>
        <Field label="Duration (minutes)"><input type="number" required min={1} max={10080} value={draft.durationMinutes} onChange={e => set("durationMinutes", Number(e.target.value))} /></Field>
        <Field label="Time zone"><input required maxLength={100} value={draft.timeZone} onChange={e => set("timeZone", e.target.value)} /></Field>
      </div>
      <div className="ds-calendar-field-pair">
        <Field label="Type"><select value={draft.kind} onChange={e => set("kind", e.target.value as EventInput["kind"])}><option value="event">Event</option><option value="lecture">Lecture</option><option value="block">Time block</option></select></Field>
        <Field label="Repeats"><select value={draft.recurrenceKind} onChange={e => set("recurrenceKind", e.target.value as EventInput["recurrenceKind"])}><option value="none">Once</option><option value="weekly">Weekly on this weekday</option></select></Field>
        {draft.recurrenceKind === "weekly" && <Field label="Last date"><input type="date" required min={draft.anchorLocalDate} value={draft.recurrenceUntilDate ?? ""} onChange={e => set("recurrenceUntilDate", e.target.value)} /></Field>}
        <Field label="Attendance plan"><select value={draft.attendanceIntent} onChange={e => set("attendanceIntent", e.target.value as EventInput["attendanceIntent"])}><option value="undecided">Undecided</option><option value="attend">Plan to attend</option><option value="skip">Plan to skip / study independently</option></select></Field>
      </div>
      <Field label="Location"><input maxLength={500} value={draft.location} onChange={e => set("location", e.target.value)} placeholder="Optional" /></Field>
      <details><summary className="ds-focus rounded-control py-3 text-meta text-ink-2">Details, study folder and clock changes</summary>
        <div className="grid gap-5 pt-3">
          <Field label="Description"><textarea maxLength={5000} rows={3} value={draft.description} onChange={e => set("description", e.target.value)} /></Field>
          <Field label="Study folder"><select disabled={!foldersAvailable} value={draft.notesFolderId ?? ""} onChange={e => set("notesFolderId", e.target.value || null)}>
            <option value="">No linked folder</option>
            {draft.notesFolderId && !folders.some(f => f.id === draft.notesFolderId) && <option value={draft.notesFolderId}>Existing folder (not loaded)</option>}
            {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
          </select></Field>
          {!foldersAvailable && <p className="text-meta text-ink-2">Folders are unavailable. Any existing link is preserved.</p>}
          <Field label="Clock changes"><select value={draft.dstPolicy} onChange={e => set("dstPolicy", e.target.value as EventInput["dstPolicy"])}><option value="reject">Ask if this local time occurs twice</option><option value="earlier">Use the earlier occurrence</option><option value="later">Use the later occurrence</option></select></Field>
        </div>
      </details>
      <p className="text-meta text-ink-2">Event-linked notifications are not available yet. Standalone reminders remain separate.</p>
      {error && <p role="alert" className="text-body text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" className="ds-focus ds-calendar-quiet" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="ds-focus ds-calendar-primary" disabled={busy || blocked}>{busy ? "Saving…" : "Save event"}</button>
      </div>
    </form>
  </Sheet>;
}

export function AttendanceEditor({ occurrence, onClose, onSaved }: { occurrence: CalendarOccurrence; onClose: () => void; onSaved: () => void }) {
  const [intent, setIntent] = useState(occurrence.attendanceIntent), [outcome, setOutcome] = useState(occurrence.attendanceOutcome);
  const [cancelled, setCancelled] = useState(occurrence.cancelled);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (sending.current || blocked) return;
    sending.current = true; setBusy(true);
    try {
      await updateOccurrence(occurrence, { attendanceIntentOverride: intent, attendanceOutcome: outcome,
        ...(cancelled !== occurrence.cancelled ? { cancelled } : {}) });
      if (mounted.current) onSaved();
    } catch (error) { if (mounted.current) { setError(errorText(error)); setBlocked(true); } }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Sheet open onOpenChange={open => { if (!open && !busy) onClose(); }} title="This occurrence" description={`${occurrence.title} · ${occurrence.originalLocalDate}`} className="ds-calendar-editor">
    <form className="ds-calendar-form" onSubmit={e => { void save(e); }}>
      <Field label="My plan"><select value={intent} onChange={e => setIntent(e.target.value as typeof intent)}><option value="undecided">Undecided</option><option value="attend">Attend</option><option value="skip">Skip / study independently</option></select></Field>
      <Field label="What happened"><select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="unknown">Not recorded</option><option value="attended">Attended</option><option value="skipped">Intentionally skipped</option><option value="missed">Missed</option></select></Field>
      {occurrence.startsAt > Date.now() && <label className="flex min-h-11 items-center gap-3 text-body"><input type="checkbox" checked={cancelled} onChange={e => setCancelled(e.target.checked)} />Cancel only this occurrence</label>}
      <p className="text-meta text-ink-2">Your plan and what actually happened are separate. AVA does not infer attendance.</p>
      {error && <p role="alert" className="text-body text-danger">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" className="ds-focus ds-calendar-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="ds-focus ds-calendar-primary" disabled={busy || blocked}>{busy ? "Saving…" : "Save occurrence"}</button></div>
    </form>
  </Sheet>;
}
