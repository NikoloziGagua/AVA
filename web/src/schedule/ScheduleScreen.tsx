import { useMemo, useState } from "react";
import { BellRing, LoaderCircle, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { createReminderApi, deleteWatchApi, type WatchRow } from "../api.js";
import { createErrorMessage, createOutcomeUnknown, unconfirmedCreateMessage } from "../reminders/createErrors.js";
import { fetchedAtLabel, useReminderFeed } from "../reminders/useReminderFeed.js";
import { orderReminders, presentReminder } from "../reminders/presenter.js";
import { ReminderStatusChip } from "../reminders/ReminderStatusChip.js";
import { resolveWhen, WhenField, type Occurrence } from "../reminders/WhenField.js";
import { browserTimeZone, wallTimeValue } from "../reminders/time.js";

function defaultWhen(zone: string): string {
  // The next whole hour at least 30 minutes away.
  const next = new Date(Date.now() + 30 * 60_000);
  next.setMinutes(0, 0, 0);
  return wallTimeValue(next.getTime() + 60 * 60_000, zone);
}

/**
 * Schedule: dependable one-off reminders (contract i4-one-off-reminders v1).
 * A reminder shows in the list only after the server has stored it, and its
 * status never goes beyond what the notification service confirmed.
 */
export function ScheduleScreen({ onOpenTalk }: { onOpenTalk: () => void }) {
  const { feed, refresh, forget } = useReminderFeed();
  const now = feed.status === "ok" ? feed.fetchedAt : Date.now();
  const lists = useMemo(
    () => (feed.status === "ok" ? orderReminders(feed.watches, feed.fetchedAt) : null),
    [feed],
  );

  return (
    <PanelShell title="Schedule">
      <PanelSection title="New reminder">
        <ReminderForm refresh={refresh} />
      </PanelSection>

      <PanelSection title="Reminders">
        {feed.status === "loading" && <p role="status" className="text-xs text-white/55">Loading reminders…</p>}
        {feed.status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-3 text-sm text-white/70">
            <span>{feed.message}</span>
            <button type="button" className="btn-deck btn-ghost" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {feed.status === "ok" && feed.stale && (
          <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200/20 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-50/80">
            <span>Couldn't refresh. Showing reminders as of {fetchedAtLabel(feed.fetchedAt)}; their status may have changed since.</span>
            <button type="button" className="btn-deck btn-ghost" onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {lists && lists.upcoming.length === 0 && lists.earlier.length === 0 && (
          <p className="text-sm text-white/60">No reminders yet. Add one above, or ask AVA in Talk.</p>
        )}
        {lists && lists.upcoming.length > 0 && (
          <ReminderList title="Upcoming" watches={lists.upcoming} now={now} refresh={refresh} forget={forget} />
        )}
        {lists && lists.earlier.length > 0 && (
          <ReminderList title="Earlier" watches={lists.earlier} now={now} refresh={refresh} forget={forget} />
        )}
      </PanelSection>

      <PanelSection title="How reminders reach you">
        <div className="flex max-w-xl flex-col gap-3 text-sm leading-6 text-white/70">
          <p>
            When a reminder is due, AVA hands it to the notification service for the devices registered
            with it. AVA can see whether the service accepted it. It can't see whether your phone showed it.
          </p>
          <p className="text-white/60">
            If no device is registered for notifications yet, the reminder says so instead of pretending.
          </p>
          <div>
            <button type="button" onClick={onOpenTalk} className="btn-deck btn-ghost">
              <MessageSquareText size={14} aria-hidden />
              <span>Go to Talk</span>
            </button>
          </div>
        </div>
      </PanelSection>
    </PanelShell>
  );
}

function ReminderForm({ refresh }: { refresh: () => Promise<WatchRow[] | null> }) {
  const zone = useMemo(() => browserTimeZone(), []);
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState(() => defaultWhen(zone));
  const [occurrence, setOccurrence] = useState<Occurrence>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = () => {
    setPrompt("");
    setWhen(defaultWhen(zone));
    setOccurrence(null);
    setAttempted(false);
  };

  const save = async () => {
    if (saving) return;
    setAttempted(true);
    setError(null);
    setNotice(null);
    const text = prompt.trim();
    if (!text) { setError("Write what AVA should remind you about."); return; }
    const resolved = resolveWhen(when, occurrence, zone);
    if (!resolved.ok) return; // WhenField already shows why

    setSaving(true);
    try {
      await createReminderApi({ prompt: text, runAt: resolved.instant, timeZone: zone });
      done();
      setNotice("Reminder saved.");
      await refresh();
    } catch (cause) {
      if (createOutcomeUnknown(cause)) {
        // The write may still land later, and a matching row in the list would
        // not prove it was this one: never resend, show the list, let Sir decide.
        setError(unconfirmedCreateMessage((await refresh()) !== null));
      } else {
        setError(createErrorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
      <label className="flex flex-col gap-2 text-xs text-white/60">
        <span>What should AVA remind you about?</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          readOnly={saving}
          maxLength={2000}
          rows={2}
          className="min-h-16 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/90 outline-none focus-visible:border-[var(--ac)]/50"
          placeholder="Submit the algorithms coursework"
        />
      </label>
      <WhenField
        label="When"
        value={when}
        onChange={setWhen}
        occurrence={occurrence}
        onOccurrenceChange={setOccurrence}
        zone={zone}
        disabled={saving}
        showErrors={attempted}
      />
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
      {notice && <p role="status" className="text-xs text-white/70">{notice}</p>}
      <div>
        <button type="submit" className="btn-deck btn-primary" disabled={saving || !prompt.trim()}>
          {saving ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
          <span>{saving ? "Saving…" : "Save reminder"}</span>
        </button>
      </div>
    </form>
  );
}

function ReminderList({ title, watches, now, refresh, forget }: {
  title: string;
  watches: WatchRow[];
  now: number;
  refresh: () => Promise<WatchRow[] | null>;
  forget: (id: string) => void;
}) {
  return (
    <section aria-label={title} className="mb-5 last:mb-0">
      <h3 className="hud mb-2 text-[10px] text-white/50">{title}</h3>
      <ul className="flex flex-col gap-2">
        {watches.map((watch) => <ReminderItem key={watch.id} watch={watch} now={now} refresh={refresh} forget={forget} />)}
      </ul>
    </section>
  );
}

function ReminderItem({ watch, now, refresh, forget }: {
  watch: WatchRow;
  now: number;
  refresh: () => Promise<WatchRow[] | null>;
  forget: (id: string) => void;
}) {
  const view = presentReminder(watch, now)!;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteWatchApi(watch.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "It could not be deleted.");
      setDeleting(false);
      setConfirming(false);
      return;
    }
    // Deleted on the server: drop the row now, whatever the refresh does.
    forget(watch.id);
    void refresh();
  };

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      {/* On a phone a long status moves under the text instead of overflowing. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <BellRing size={16} className="mt-0.5 shrink-0 text-[var(--ac-exec)]" aria-hidden />
        <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-sm text-white/90 [overflow-wrap:anywhere]">{watch.prompt}</span>
          <span className="text-[11px] text-white/50">{view.due}</span>
        </div>
        <ReminderStatusChip presentation={view} />
      </div>
      <p className="text-xs leading-5 text-white/60">{view.detail}</p>
      {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!confirming ? (
          <button type="button" className="btn-deck btn-ghost" onClick={() => setConfirming(true)} aria-label={`Delete reminder: ${watch.prompt}`}>
            <Trash2 size={13} aria-hidden />
            <span>Delete</span>
          </button>
        ) : (
          <>
            <button type="button" className="btn-deck btn-danger" disabled={deleting} onClick={() => void remove()}>
              {deleting ? "Deleting…" : "Delete it"}
            </button>
            <button type="button" className="btn-deck btn-ghost" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        )}
      </div>
    </li>
  );
}
