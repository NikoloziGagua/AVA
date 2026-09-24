import { useEffect, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { createNote, fetchNotes, type Note } from "../notes/api.js";

/** Nika's ideas: notes with kind "idea", newest first. */
export function ideasFrom(notes: Note[]): Note[] {
  return notes
    .filter((note) => note.kind === "idea" && note.status !== "archived")
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function formatWhen(value: number): string {
  const d = new Date(value);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
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

  const refresh = async () => {
    try {
      const snapshot = await fetchNotes();
      setLoad({ status: "ok", ideas: ideasFrom(snapshot.notes) });
    } catch (error) {
      setLoad({ status: "error", message: error instanceof Error ? error.message : "Ideas could not be loaded." });
    }
  };

  useEffect(() => { void refresh(); }, []);

  const save = async () => {
    const submitted = draft;
    const content = submitted.trim();
    if (!content || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createNote({ content, kind: "idea", section: "capture", projectId: null });
      // Clear only the words that were saved, never anything newer.
      setDraft((current) => (current === submitted ? "" : current));
      await refresh();
    } catch (error) {
      // Keep the words; say what went wrong.
      setSaveError(error instanceof Error ? error.message : "That idea could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelShell title="Ideas">
      <PanelSection title="New idea">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => { event.preventDefault(); void save(); }}
        >
          <label className="flex flex-col gap-2 text-xs text-white/60">
            <span>What's the idea?</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              // Held still while saving, so no new words can be lost.
              readOnly={saving}
              aria-busy={saving || undefined}
              rows={3}
              className="min-h-20 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/90 outline-none focus-visible:border-[var(--ac)]/50"
              placeholder="A thought worth keeping…"
            />
          </label>
          {saveError && <p role="alert" className="text-xs text-red-300">{saveError}</p>}
          <div>
            <button type="submit" className="btn-deck btn-primary" disabled={!draft.trim() || saving}>
              <Plus size={14} aria-hidden />
              <span>{saving ? "Saving…" : "Save idea"}</span>
            </button>
          </div>
        </form>
      </PanelSection>

      <PanelSection title="Your ideas">
        {load.status === "loading" && <p role="status" className="text-xs text-white/55">Loading ideas…</p>}
        {load.status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-3 text-sm text-white/70">
            <span>{load.message}</span>
            <button type="button" className="btn-deck btn-ghost" onClick={() => { setLoad({ status: "loading" }); void refresh(); }}>
              Retry
            </button>
          </div>
        )}
        {load.status === "ok" && load.ideas.length === 0 && (
          <p className="text-sm text-white/60">No ideas yet. Write one above, or tell AVA in Talk.</p>
        )}
        {load.status === "ok" && load.ideas.length > 0 && (
          <ul className="flex flex-col gap-2">
            {load.ideas.map((idea) => (
              <li key={idea.id}>
                <button
                  type="button"
                  onClick={() => onOpenNote(idea.id)}
                  className="flex w-full items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-left transition-colors hover:border-[var(--ac)]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ac)]"
                >
                  <Lightbulb size={16} className="mt-0.5 shrink-0 text-[var(--ac-exec)]" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm text-white/90">{idea.title || "Untitled idea"}</span>
                    {idea.content && <span className="text-xs leading-5 text-white/55">{excerpt(idea.content)}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-white/45">{formatWhen(idea.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </PanelShell>
  );
}
