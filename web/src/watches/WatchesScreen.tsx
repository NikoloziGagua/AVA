import { useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BellRing,
  Bot,
  CalendarClock,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  createWatchApi,
  deleteWatchApi,
  fetchWatches,
  setWatchEnabled,
  type CreateWatchInput,
  type WatchRow,
} from "../api.js";
import { BorderGlow } from "../components/ava/BorderGlow.js";
import { PanelShell } from "../components/ava/PanelShell.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { scheduleLabel, timeAgo } from "../memory/WatchesSection.js";

const REFRESH_MS = 15_000;
type Filter = "all" | "active" | "paused" | "attention";
type ScheduleMode = "interval" | "once" | "daily";

const ATTENTION = new Set(["error", "unclear", "busy"]);

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The watch request failed.";
}

function localDateTimeValue(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function watchStatusLabel(watch: WatchRow): string {
  if (!watch.enabled) return "Paused";
  if (!watch.last_status) return "Waiting for first run";
  const labels: Record<string, string> = {
    ok: "Checked · no trigger",
    triggered: "Triggered",
    unclear: "Result unclear",
    error: "Check failed",
    busy: "Waiting for target",
    dispatching: "Dispatching",
    delivered: "Delivered",
    running: "Running",
    completed: "Completed",
  };
  return labels[watch.last_status] ?? `Status: ${watch.last_status}`;
}

function statusTone(watch: WatchRow): string {
  if (!watch.enabled) return "border-white/10 bg-white/[0.035] text-white/55";
  if (watch.last_status === "error") return "border-red-300/25 bg-red-400/[0.07] text-red-100";
  if (watch.last_status === "unclear" || watch.last_status === "busy") {
    return "border-amber-200/25 bg-amber-300/[0.07] text-amber-100";
  }
  if (["triggered", "delivered", "running"].includes(String(watch.last_status))) {
    return "border-[var(--ac-exec)]/25 bg-[var(--ac-exec)]/[0.07] text-[var(--ac-exec)]";
  }
  return "border-[var(--ac)]/25 bg-[var(--ac)]/[0.06] text-[var(--ac)]";
}

function WatchMetric({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/35 px-4 py-3">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="hud mt-1 text-[9px] tracking-[0.16em] text-white/40">{label}</div>
    </div>
  );
}

function CreateWatchPanel({ onCreated }: { onCreated: (watch: WatchRow) => void }) {
  const [kind, setKind] = useState<"check" | "reminder">("check");
  const [mode, setMode] = useState<ScheduleMode>("interval");
  const [prompt, setPrompt] = useState("");
  const [interval, setIntervalMinutes] = useState("30");
  const [runAt, setRunAt] = useState(() => localDateTimeValue(Date.now() + 60 * 60_000));
  const [dailyAt, setDailyAt] = useState("09:00");
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) { setError("Describe what AVA should watch or remind you about."); return; }

    const input: CreateWatchInput = { prompt: cleanPrompt, kind, once: mode === "once" || !repeat };
    if (mode === "interval") {
      const minutes = Number(interval);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        setError("Choose an interval from 5 minutes to 24 hours.");
        return;
      }
      input.intervalMinutes = minutes;
    } else if (mode === "once") {
      const at = new Date(runAt).getTime();
      if (!Number.isFinite(at) || at <= Date.now()) {
        setError("Choose a future date and time.");
        return;
      }
      input.runAt = at;
    } else {
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(dailyAt)) {
        setError("Choose a valid daily time.");
        return;
      }
      input.dailyAt = dailyAt;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await createWatchApi(input);
      onCreated(created);
      setPrompt("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BorderGlow dataPanelSection className="lg:col-span-5 px-5 py-5 sm:px-6 sm:py-6">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Plus size={16} className="text-[var(--ac)]" /> New watch
          </div>
          <p className="mt-1 text-xs leading-5 text-white/45">Create a scheduled AVA check or a direct reminder.</p>
        </div>
        <span className="chip chip-ac">durable</span>
      </div>

      <form className="space-y-4" onSubmit={submit} noValidate>
        <fieldset>
          <legend className="hud mb-2 text-[9px] tracking-[0.16em] text-white/45">TYPE</legend>
          <SegmentedTabs
            options={[{ value: "check", label: "AVA check" }, { value: "reminder", label: "Reminder" }]}
            value={kind}
            onChange={setKind}
            layout="auto"
          />
        </fieldset>

        <label className="block text-xs text-white/55">
          <span className="mb-2 block">{kind === "check" ? "What should AVA check?" : "What should AVA remind you?"}</span>
          <textarea
            aria-label={kind === "check" ? "What should AVA check?" : "What should AVA remind you?"}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={2000}
            className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-[var(--ac)]/45 focus:ring-2 focus:ring-[var(--ac)]/10"
            placeholder={kind === "check" ? "Tell me when the project status page changes…" : "Stand up and stretch"}
          />
          <span className="mt-1 block text-right text-[10px] text-white/30">{prompt.length}/2000</span>
        </label>

        <fieldset>
          <legend className="hud mb-2 text-[9px] tracking-[0.16em] text-white/45">SCHEDULE</legend>
          <SegmentedTabs<ScheduleMode>
            options={[{ value: "interval", label: "Interval" }, { value: "once", label: "One time" }, { value: "daily", label: "Daily" }]}
            value={mode}
            onChange={setMode}
            layout="auto"
          />
        </fieldset>

        {mode === "interval" && (
          <label className="block text-xs text-white/55">
            <span className="mb-2 block">Check every</span>
            <div className="flex items-center gap-3">
              <input
                aria-label="Interval minutes"
                type="number"
                min={5}
                max={1440}
                step={1}
                value={interval}
                onChange={(event) => setIntervalMinutes(event.target.value)}
                className="w-28 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ac)]/40"
              />
              <span className="text-white/40">minutes</span>
            </div>
          </label>
        )}

        {mode === "once" && (
          <label className="block text-xs text-white/55">
            <span className="mb-2 block">Run at</span>
            <input
              aria-label="Run at"
              type="datetime-local"
              value={runAt}
              min={localDateTimeValue(Date.now() + 60_000)}
              onChange={(event) => setRunAt(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ac)]/40"
            />
          </label>
        )}

        {mode === "daily" && (
          <label className="block text-xs text-white/55">
            <span className="mb-2 block">Every day at</span>
            <input
              aria-label="Every day at"
              type="time"
              value={dailyAt}
              onChange={(event) => setDailyAt(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[var(--ac)]/40"
            />
          </label>
        )}

        {mode !== "once" && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3 text-xs text-white/60">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(event) => setRepeat(event.target.checked)}
              className="mt-0.5 accent-cyan-300"
            />
            <span>
              <strong className="block font-medium text-white/85">Keep running after it triggers</strong>
              {kind === "check" ? "Off by default to prevent repeated alerts." : "Turn on for a recurring reminder."}
            </span>
          </label>
        )}

        {kind === "check" && (
          <div className="flex gap-2 rounded-xl border border-amber-200/15 bg-amber-300/[0.045] px-3.5 py-3 text-[11px] leading-5 text-amber-50/65">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-amber-200/70" />
            Each check is a real AVA task and may use model or tool time. Longer intervals are cheaper.
          </div>
        )}

        {error && <div role="alert" className="rounded-lg border border-red-300/20 bg-red-400/[0.07] px-3 py-2 text-xs text-red-100">{error}</div>}
        <button type="submit" disabled={busy || !prompt.trim()} className="btn-deck btn-primary w-full justify-center">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
          {busy ? "Creating…" : "Create watch"}
        </button>
      </form>
    </BorderGlow>
  );
}

function WatchCard({ watch, busy, onToggle, onDelete, onOpenChat }: {
  watch: WatchRow;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onOpenChat: (sessionId: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const Icon = watch.kind === "reminder" ? BellRing : watch.kind === "codex" ? Bot : Search;
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-black/40 px-4 py-4 sm:px-5" aria-label={`Watch: ${watch.prompt}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-white/10 bg-white/[0.045] p-2 text-[var(--ac)]"><Icon size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 hud text-[9px] tracking-[0.13em] ${statusTone(watch)}`}>{watchStatusLabel(watch)}</span>
            <span className="hud text-[9px] tracking-[0.14em] text-white/35">{watch.kind === "reminder" ? "REMINDER" : watch.kind === "codex" ? "CODEX DELIVERY" : "AVA CHECK"}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-white/88">{watch.prompt}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 hud text-[9px] tracking-[0.14em] text-white/38">
            <span className="flex items-center gap-1.5"><CalendarClock size={12} />{scheduleLabel(watch)}</span>
            <span>created {timeAgo(watch.created_at)}</span>
            {watch.last_run_at && <span>last activity {timeAgo(watch.last_run_at)}</span>}
          </div>
          {watch.last_result && (
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-xs leading-5 text-white/58">
              <span className="hud mr-2 text-[9px] tracking-[0.14em] text-white/35">LAST RESULT</span>
              {watch.last_result}
            </div>
          )}
          {watch.kind === "codex" && watch.successor_status && (
            <div className="mt-2 text-[11px] text-white/50">Successor: {watch.successor_status}{watch.successor_result ? ` · ${watch.successor_result}` : ""}</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
        {watch.session_id && (
          <button type="button" className="btn-deck btn-ghost" onClick={() => onOpenChat(watch.session_id!)}>
            <ExternalLink size={14} /> Open history
          </button>
        )}
        <button type="button" disabled={busy} className="btn-deck btn-ghost" onClick={onToggle} aria-label={`${watch.enabled ? "Pause" : "Resume"} ${watch.prompt}`}>
          {watch.enabled ? <Pause size={14} /> : <Play size={14} />}{watch.enabled ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-deck btn-danger"
          aria-label={armed ? `Confirm delete ${watch.prompt}` : `Delete ${watch.prompt}`}
          onClick={() => armed ? onDelete() : setArmed(true)}
        >
          <Trash2 size={14} />{armed ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </article>
  );
}

export function WatchesScreen({ onOpenChat }: { onOpenChat: (sessionId: string) => void }) {
  const [watches, setWatches] = useState<WatchRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(quiet = false) {
    try {
      setWatches(await fetchWatches());
      if (!quiet) setError(null);
    } catch (cause) {
      if (!quiet) setError(errorMessage(cause));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    const focus = () => void load(true);
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);

  const visible = useMemo(() => {
    if (!watches) return [];
    const needle = query.trim().toLocaleLowerCase();
    return watches.filter((watch) => {
      if (filter === "active" && !watch.enabled) return false;
      if (filter === "paused" && watch.enabled) return false;
      if (filter === "attention" && !ATTENTION.has(String(watch.last_status))) return false;
      return !needle || [watch.prompt, watch.last_result, watch.kind, watch.last_status].join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [filter, query, watches]);

  const active = watches?.filter((watch) => Boolean(watch.enabled)).length ?? 0;
  const attention = watches?.filter((watch) => ATTENTION.has(String(watch.last_status))).length ?? 0;

  async function toggle(watch: WatchRow) {
    const enabled = !watch.enabled;
    setBusyId(watch.id);
    setError(null);
    try {
      await setWatchEnabled(watch.id, enabled);
      setWatches((current) => current?.map((row) => row.id === watch.id ? { ...row, enabled: enabled ? 1 : 0 } : row) ?? current);
    } catch (cause) {
      setError(errorMessage(cause));
      await load(true);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(watch: WatchRow) {
    setBusyId(watch.id);
    setError(null);
    try {
      await deleteWatchApi(watch.id);
      setWatches((current) => current?.filter((row) => row.id !== watch.id) ?? current);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PanelShell title="Watches" grid>
      <section className="lg:col-span-12" data-panel-section>
        <div className="grid gap-3 sm:grid-cols-3">
          <WatchMetric label="TOTAL WATCHES" value={watches?.length ?? 0} />
          <WatchMetric label="ACTIVE" value={active} tone="text-[var(--ac-live)]" />
          <WatchMetric label="NEED ATTENTION" value={attention} tone={attention ? "text-amber-200" : "text-white"} />
        </div>
      </section>

      <CreateWatchPanel onCreated={(watch) => setWatches((current) => [watch, ...(current ?? [])])} />

      <BorderGlow dataPanelSection className="lg:col-span-7 px-5 py-5 sm:px-6 sm:py-6">
        <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.07] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><AlarmClock size={16} className="text-[var(--ac)]" /> Your watches</div>
              <p className="mt-1 text-xs text-white/42">The scheduler runs only while AVA is online.</p>
            </div>
            <button type="button" className="btn-deck btn-ghost" onClick={() => void load()} aria-label="Refresh watches">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <SegmentedTabs<Filter>
              options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "attention", label: "Attention" }]}
              value={filter}
              onChange={setFilter}
              layout="auto"
              className="flex-wrap"
            />
            <label className="relative min-w-0 xl:w-60">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <span className="sr-only">Search watches</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search watches" className="w-full rounded-lg border border-white/10 bg-black/50 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-[var(--ac)]/40" />
            </label>
          </div>
        </div>

        {error && <div role="alert" className="mb-4 rounded-xl border border-red-300/20 bg-red-400/[0.07] px-4 py-3 text-xs text-red-100">{error}</div>}
        {!watches && !error && <div className="flex h-44 items-center justify-center gap-2 text-xs text-white/45"><LoaderCircle size={16} className="animate-spin" />Loading watches…</div>}
        {watches && visible.length === 0 && (
          <div className="flex h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center">
            <Clock3 size={22} className="mb-3 text-white/25" />
            <div className="text-sm text-white/65">{watches.length ? "No watches match this view." : "No watches yet."}</div>
            <div className="mt-1 text-xs text-white/35">Create one here or ask AVA conversationally.</div>
          </div>
        )}
        <div className="space-y-3">
          {visible.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              busy={busyId === watch.id}
              onToggle={() => void toggle(watch)}
              onDelete={() => void remove(watch)}
              onOpenChat={onOpenChat}
            />
          ))}
        </div>
      </BorderGlow>
    </PanelShell>
  );
}
