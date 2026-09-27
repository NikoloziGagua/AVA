import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { MetalObject } from "../design/metal/MetalObject.js";
import { DEFAULT_TIME_ZONE } from "../calendar/api.js";
import { createOutcomeUnknown } from "../reminders/createErrors.js";
import { createNote, fetchNotes, type Note } from "../notes/api.js";

/** Nika's ideas: notes with kind "idea", newest first. */
export function ideasFrom(notes: Note[]): Note[] {
  return notes
    .filter((note) => note.kind === "idea" && note.status !== "archived")
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function formatWhen(value: number): string {
  return new Intl.DateTimeFormat("en-IE", { timeZone: DEFAULT_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; ideas: Note[] };

/**
 * Ideas list over the existing notes API. Editing stays in Notes: opening an
 * idea hands its exact id to the Notes screen.
 */
export function IdeasScreen({ onOpenNote }: { onOpenNote: (noteId: string) => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const savePending = useRef(false);

  const refresh = async () => {
    const version = ++requestVersion.current;
    try {
      const snapshot = await fetchNotes({ kind: "idea" });
      if (mounted.current && version === requestVersion.current) {
        setLoad({ status: "ok", ideas: ideasFrom(snapshot.notes) });
        return true;
      }
    } catch (error) {
      if (mounted.current && version === requestVersion.current) setLoad({ status: "error", message: error instanceof Error ? error.message : "Ideas could not be loaded." });
    }
    return false;
  };

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; requestVersion.current++; };
  }, []);

  const save = async () => {
    const submitted = draft;
    const content = submitted.trim();
    // React may not have committed disabled yet on two synchronous submissions.
    if (!content || content.length > 30_000 || savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await createNote({ content, kind: "idea", section: "capture", projectId: null });
      if (!mounted.current) return;
      // Clear only the words that were saved, never anything newer.
      setDraft((current) => (current === submitted ? "" : current));
      setSaved(true);
      await refresh();
    } catch (error) {
      // Keep the words; say what went wrong.
      if (!mounted.current) return;
      if (createOutcomeUnknown(error)) {
        const refreshed = await refresh();
        if (mounted.current) setSaveError(refreshed
          ? "It may have been saved. Your ideas have been refreshed, but a matching idea is not proof. Check the list before saving again. Your words are kept here."
          : "It may have been saved, and the list could not be refreshed. Check Your ideas when AVA is reachable before saving again. Your words are kept here.");
      } else setSaveError(error instanceof Error ? error.message : "That idea could not be saved.");
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <section aria-label="Ideas" className="ds-root ds-ideas h-full overflow-y-auto bg-canvas text-ink">
      <Atmosphere kind="silk" />
      <div className="ds-ideas-content">
      <header className="ds-ideas-header">
        <p className="ds-ideas-eyebrow">IDEAS</p>
        <h1>Keep the spark.</h1>
        <p>A thought now. Something worth returning to later.</p>
      </header>
      <section aria-label="New idea" className="ds-ideas-capture">
        <form
          onSubmit={(event) => { event.preventDefault(); void save(); }}
        >
          <label className="ds-ideas-field">
            <span>What's the idea?</span>
            <textarea
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setSaved(false); setSaveError(null); }}
              // Held still while saving, so no new words can be lost.
              readOnly={saving}
              aria-busy={saving || undefined}
              rows={3}
              maxLength={30_000}
              placeholder="A thought worth keeping…"
            />
          </label>
          {saveError && <p role="alert" className="text-body text-danger">{saveError}</p>}
          <div className="ds-ideas-capture-footer">
            <p role="status">{saved ? "Idea saved." : "Saved ideas open in Notes for editing."}</p>
            <button type="submit" className="ds-ideas-save ds-focus" disabled={!draft.trim() || saving} aria-busy={saving || undefined}>
              <Plus size={14} aria-hidden />
              <span>{saving ? "Saving…" : "Save idea"}</span>
            </button>
          </div>
        </form>
      </section>

      <section aria-label="Your ideas" className="ds-ideas-library">
        <header><h2>Your ideas</h2><p>Most recently updated first</p></header>
        {load.status === "ok" && load.ideas.length === 250 && <p role="status" className="mb-5 text-meta text-ink-2">Showing 250 loaded ideas; other ideas may not be included.</p>}
        {load.status === "loading" && <p role="status" className="text-body text-ink-2">Loading ideas…</p>}
        {load.status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-3 text-body text-ink-2">
            <span>{load.message}</span>
            <button type="button" className="ds-ideas-retry ds-focus" onClick={() => { setLoad({ status: "loading" }); void refresh(); }}>
              Retry
            </button>
          </div>
        )}
        {load.status === "ok" && load.ideas.length === 0 && (
          <p className="text-body text-ink-2">No ideas yet. Write one above, or tell AVA in Talk.</p>
        )}
        {load.status === "ok" && load.ideas.length > 0 && (
          <ul className="ds-ideas-grid">
            {load.ideas.map((idea) => (
              <li key={idea.id}>
                <MetalObject
                  variant="twin"
                  eyebrow="UPDATED"
                  value={new Intl.DateTimeFormat("en-IE", { timeZone: DEFAULT_TIME_ZONE, day: "numeric", month: "short" }).format(idea.updatedAt)}
                  title={idea.title || "Untitled idea"}
                  label={`Open ${idea.title || "Untitled idea"} in Notes`}
                  detail={<>{idea.content && <span>{excerpt(idea.content)}</span>}<time dateTime={new Date(idea.updatedAt).toISOString()}>Updated {formatWhen(idea.updatedAt)} · Dublin</time></>}
                  onClick={() => onOpenNote(idea.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </section>
  );
}
