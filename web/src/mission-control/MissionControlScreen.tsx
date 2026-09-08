import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Coins,
  Download,
  Eye,
  FileJson,
  Octagon,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  Square,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import {
  ApiError,
  fetchMissionExport,
  fetchMissionMeta,
  fetchMissionRun,
  fetchMissionRuns,
  saveMissionExport,
  stopMissionRun,
  subscribeMissionEvents,
  type MissionEvent,
  type MissionEvidenceExport,
  type MissionExportScope,
  type MissionRun,
} from "../api.js";

const ACTIVE = new Set([
  "queued",
  "starting",
  "running",
  "waiting_for_agent",
  "waiting_for_user",
  "waiting_for_approval",
  "retrying",
  "verifying",
  "cancelling",
]);

function formatAge(at: number): string {
  const delta = Math.max(0, Date.now() - at);
  if (delta < 1_000) return "now";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(at).toLocaleDateString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
}

function elapsed(run: MissionRun): number {
  return Math.max(0, (run.completedAt ?? Date.now()) - run.startedAt);
}

function operationalSummary(run: MissionRun): string {
  if (ACTIVE.has(run.status)) {
    return run.status === "waiting_for_approval"
      ? "AVA is waiting for an approval decision."
      : run.status === "waiting_for_user"
        ? "AVA is waiting for more information from Niko."
        : "AVA is actively processing this run. Open the sanitized request in Run context if needed.";
  }
  if (run.status === "completed") {
    return run.verificationStatus === "verified"
      ? "The run completed with recorded verification evidence."
      : "The run completed, but its external outcome is not independently verified.";
  }
  if (run.status === "cancelled") return "The run was cancelled before normal completion.";
  if (run.status === "failed" || run.status === "timed_out" || run.status === "orphaned") {
    return "The run did not complete normally. Inspect errors and the final timeline events.";
  }
  return "Mission Control has recorded the run state.";
}

function statusColor(status: string): string {
  if (status === "completed" || status === "success") return "var(--ac-live)";
  if (status === "failed" || status === "error" || status === "timed_out") return "var(--ac-stop)";
  if (status === "cancelled" || status === "skipped" || status === "orphaned") return "#94a3b8";
  if (status.includes("waiting") || status === "retrying" || status === "cancelling") return "var(--ac-exec)";
  return "var(--ac)";
}

function eventIcon(event: MissionEvent) {
  if (event.type.startsWith("tool.")) return TerminalSquare;
  if (event.type.startsWith("agent.delegation")) return Route;
  if (event.type.startsWith("approval.")) return ShieldCheck;
  if (event.type.startsWith("voice.")) return Radio;
  if (event.status === "error") return AlertTriangle;
  if (event.status === "success") return CheckCircle2;
  return CircleDot;
}

function safeJson(value: unknown): string {
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function flattenRunTree(runs: MissionRun[]): Array<{ run: MissionRun; depth: number }> {
  const byParent = new Map<string | null, MissionRun[]>();
  for (const run of runs) {
    const key = run.parentRunId && runs.some((candidate) => candidate.id === run.parentRunId)
      ? run.parentRunId
      : null;
    const children = byParent.get(key) ?? [];
    children.push(run);
    byParent.set(key, children);
  }
  for (const group of byParent.values()) {
    group.sort((a, b) => {
      const liveDelta = Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status));
      return liveDelta || b.updatedAt - a.updatedAt;
    });
  }
  const result: Array<{ run: MissionRun; depth: number }> = [];
  const visit = (run: MissionRun, depth: number) => {
    result.push({ run, depth });
    for (const child of byParent.get(run.id) ?? []) visit(child, depth + 1);
  };
  for (const root of byParent.get(null) ?? []) visit(root, 0);
  return result;
}

export function MissionControlScreen() {
  const [runs, setRuns] = useState<MissionRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<MissionRun | null>(null);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<MissionEvent | null>(null);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "reconnecting" | "offline">("connecting");
  const [technical, setTechnical] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [exportSupported, setExportSupported] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<MissionExportScope>("run");
  const [exporting, setExporting] = useState(false);
  const [exportReceipt, setExportReceipt] = useState<MissionEvidenceExport | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const cursor = useRef(0);

  const loadRuns = useCallback(async () => {
    const next = await fetchMissionRuns(75);
    setRuns(next);
    setSelectedId((current) => {
      if (current && next.some((run) => run.id === current)) return current;
      return next.find((run) => ACTIVE.has(run.status))?.id ?? next[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const detail = await fetchMissionRun(id);
    setSelectedRun(detail.run);
    setEvents(detail.events);
    cursor.current = Math.max(cursor.current, ...detail.events.map((event) => event.seq), 0);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await loadRuns();
      if (selectedId) await loadDetail(selectedId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mission Control could not refresh.");
    }
  }, [loadDetail, loadRuns, selectedId]);

  useEffect(() => {
    document.title = "AVA Mission Control";
    void (async () => {
      try {
        // A new window needs live events from "now", not a replay of every
        // retained heartbeat. Reconnects still use the advancing local cursor.
        const meta = await fetchMissionMeta();
        cursor.current = Math.max(cursor.current, meta.eventBounds.max ?? 0);
        setExportSupported(meta.evidenceExport?.enabled === true);
        await loadRuns();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setStreamReady(true);
      }
    })();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedRun(null);
      setEvents([]);
      return;
    }
    setSelectedEvent(null);
    setExportOpen(false);
    setExportReceipt(null);
    void loadDetail(selectedId).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!streamReady) return;
    return subscribeMissionEvents({
      after: cursor.current,
      onState: setStreamState,
      onGap: () => void refresh(),
      onEvent: (event) => {
        cursor.current = Math.max(cursor.current, event.seq);
        if (event.runId === selectedId && event.visibility !== "system_only") {
          setEvents((current) => current.some((item) => item.seq === event.seq)
            ? current
            : [...current, event].sort((a, b) => a.seq - b.seq));
        }
        if (refreshTimer.current != null) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void refresh(), 180);
      },
    });
  }, [refresh, selectedId, streamReady]);

  useEffect(() => () => {
    if (refreshTimer.current != null) window.clearTimeout(refreshTimer.current);
  }, []);

  const tree = useMemo(() => flattenRunTree(runs), [runs]);
  const visibleEvents = useMemo(
    () => events.filter((event) => technical || event.visibility !== "system_only"),
    [events, technical],
  );
  const activeCount = runs.filter((run) => ACTIVE.has(run.status)).length;
  const detailEvent = selectedEvent;

  const stop = async () => {
    if (!selectedRun?.controlAvailable || stopping) return;
    setStopping(true);
    setError(null);
    try {
      const next = await stopMissionRun(selectedRun.id, selectedRun.version);
      setSelectedRun(next);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "stale_version") {
        await refresh();
        setError("The run changed while Stop was pressed. Mission Control refreshed it; press Stop again if it is still active.");
      } else {
        setError(cause instanceof Error ? cause.message : "Stop could not reach the run owner.");
      }
    } finally {
      setStopping(false);
    }
  };

  const exportEvidence = async () => {
    if (!selectedRun || !exportSupported || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const next = await fetchMissionExport(selectedRun.id, exportScope);
      saveMissionExport(next);
      setExportReceipt(next);
    } catch (cause) {
      setExportReceipt(null);
      setError(cause instanceof Error ? cause.message : "Mission Control could not export this evidence scope.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="h-full min-h-screen w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(92,242,255,0.09),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(124,92,255,0.08),transparent_28%)]" />
      <header className="relative z-10 flex h-[72px] items-center justify-between border-b border-white/10 px-6">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/8">
            <Activity size={20} style={{ color: "var(--ac)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-medium tracking-tight">Mission Control</h1>
              <span className="hud rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[8px] text-white/45">AVA authority</span>
            </div>
            <p className="mt-0.5 text-xs text-white/40">One correlated view of voice, agents, tools and evidence</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-white/55">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: streamState === "live" ? "var(--ac-live)" : "var(--ac-exec)" }} />
            {streamState}
          </div>
          <div className="hud text-[9px] text-white/35">{activeCount} active · {runs.length} visible</div>
          <button
            onClick={() => void refresh()}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:text-white"
            aria-label="refresh Mission Control"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {error && (
        <div className="relative z-20 mx-6 mt-3 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-100">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="relative z-10 grid h-[calc(100vh-72px)] min-h-0 grid-cols-[300px_minmax(460px,1fr)_360px]">
        <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-white/[0.015] p-3">
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="hud text-[9px] text-white/40">Runs</span>
            <Workflow size={13} className="text-white/30" />
          </div>
          {tree.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-5 text-white/35">
              No instrumented runs yet. Start a voice turn or send AVA a message.
            </div>
          )}
          <div className="space-y-1">
            {tree.map(({ run, depth }) => (
              <button
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                className={`group flex w-full items-start gap-2 rounded-xl border px-3 py-3 text-left transition ${
                  run.id === selectedId
                    ? "border-cyan-300/20 bg-cyan-300/[0.075]"
                    : "border-transparent hover:border-white/8 hover:bg-white/[0.035]"
                }`}
                style={{ paddingLeft: `${12 + Math.min(depth, 4) * 15}px` }}
              >
                {depth > 0 && <ChevronRight size={12} className="mt-1 shrink-0 text-white/25" />}
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(run.status) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-white/80">{run.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/35">
                    {run.runtimeType} · {run.runKind.replaceAll("_", " ")}
                  </span>
                </span>
                <span className="shrink-0 text-[9px] text-white/25">{formatAge(run.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-5">
          {!selectedRun ? (
            <div className="flex h-full items-center justify-center text-sm text-white/35">Select an observed run.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="hud rounded-full border px-2 py-1 text-[8px]" style={{ color: statusColor(selectedRun.status), borderColor: `color-mix(in srgb, ${statusColor(selectedRun.status)} 28%, transparent)` }}>
                      {selectedRun.status.replaceAll("_", " ")}
                    </span>
                    <span className="hud text-[8px] text-white/30">{selectedRun.runtimeId}</span>
                    {selectedRun.stale && <span className="hud text-[8px] text-amber-300">stale signal</span>}
                  </div>
                  <h2 className="truncate text-xl font-medium tracking-tight">{selectedRun.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">
                    {operationalSummary(selectedRun)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {exportSupported && (
                    <button
                      onClick={() => setExportOpen((current) => !current)}
                      aria-expanded={exportOpen}
                      className="flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] px-4 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/10"
                    >
                      <Download size={13} /> Export evidence
                    </button>
                  )}
                  {selectedRun.controlAvailable && (
                    <button
                      onClick={() => void stop()}
                      disabled={stopping}
                      className="flex shrink-0 items-center gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-2 text-xs font-medium text-red-100 transition hover:bg-red-400/15 disabled:opacity-50"
                    >
                      <Square size={12} fill="currentColor" /> {stopping ? "Stopping…" : `Stop ${selectedRun.runKind.replaceAll("_", " ")}`}
                    </button>
                  )}
                </div>
              </div>

              {exportOpen && (
                <section className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4" aria-label="Evidence export">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-medium text-white/78"><FileJson size={14} /> Privacy-safe JSON evidence</div>
                      <p className="mt-1 max-w-2xl text-[11px] leading-5 text-white/40">
                        AVA exports a fixed SQLite snapshot, re-applies redaction, and leaves collapsed prompts and sensitive payload bodies out of the file.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(["run", "trace"] as MissionExportScope[]).map((scope) => (
                        <button
                          key={scope}
                          onClick={() => { setExportScope(scope); setExportReceipt(null); }}
                          aria-pressed={exportScope === scope}
                          className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-wider transition ${
                            exportScope === scope
                              ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                              : "border-white/10 text-white/38 hover:text-white/65"
                          }`}
                        >
                          {scope}
                        </button>
                      ))}
                      <button
                        onClick={() => void exportEvidence()}
                        disabled={exporting}
                        className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[10px] text-white/72 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        <Download size={11} /> {exporting ? "Preparing..." : "Download JSON"}
                      </button>
                    </div>
                  </div>
                  {exportReceipt && (
                    <div className={`mt-3 rounded-xl border p-3 text-[10px] leading-5 ${
                      exportReceipt.completeness.partial
                        ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-100/75"
                        : "border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-100/70"
                    }`}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>Export schema v{exportReceipt.exportSchemaVersion}</span>
                        <span>{exportReceipt.scope.type} scope</span>
                        <span>{exportReceipt.bounds.rows.total} rows</span>
                        <span>Snapshot through event {exportReceipt.snapshot.highWaterEventSeq}</span>
                        <span>{new Date(exportReceipt.generatedAt).toLocaleString()}</span>
                        <span>Sanitizer reapplied</span>
                        <span>{exportReceipt.completeness.partial ? "Evidence partial" : "Complete at snapshot"}</span>
                      </div>
                      {exportReceipt.completeness.reasons.map((reason) => <div key={reason} className="mt-1">{reason}</div>)}
                    </div>
                  )}
                </section>
              )}

              <div className="mt-5 grid grid-cols-5 gap-2">
                {[
                  { icon: Clock3, label: "Elapsed", value: formatDuration(elapsed(selectedRun)) },
                  { icon: Activity, label: "Events", value: String(selectedRun.eventCount) },
                  { icon: Coins, label: "Direct cost", value: selectedRun.directCostMicrousd ? `$${(selectedRun.directCostMicrousd / 1_000_000).toFixed(4)}` : "Not reported" },
                  {
                    icon: Bot,
                    label: "Tokens",
                    value: selectedRun.inputTokens + selectedRun.outputTokens > 0
                      ? (selectedRun.inputTokens + selectedRun.outputTokens).toLocaleString()
                      : "Not reported",
                  },
                  { icon: Eye, label: "Verification", value: selectedRun.verificationStatus.replaceAll("_", " ") },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                    <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/30"><Icon size={11} /> {label}</div>
                    <div className="mt-2 truncate text-xs text-white/72">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio size={14} style={{ color: "var(--ac)" }} />
                  <h3 className="hud text-[10px] text-white/55">Live timeline</h3>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/35">
                  <input type="checkbox" checked={technical} onChange={(event) => setTechnical(event.target.checked)} className="accent-cyan-300" />
                  technical signals
                </label>
              </div>

              <div className="relative mt-3 space-y-2 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-white/10">
                {visibleEvents.map((event) => {
                  const Icon = eventIcon(event);
                  return (
                    <button
                      key={event.seq}
                      onClick={() => setSelectedEvent(event)}
                      className={`relative flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        selectedEvent?.seq === event.seq
                          ? "border-cyan-300/20 bg-cyan-300/[0.055]"
                          : "border-white/7 bg-black/25 hover:border-white/14"
                      }`}
                    >
                      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#090c11]" style={{ color: statusColor(event.status) }}>
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-white/78">{event.title}</span>
                          {event.late && <span className="hud rounded bg-amber-300/10 px-1.5 py-0.5 text-[7px] text-amber-200">late · not applied</span>}
                          {event.actionOwner === "observer" && <span className="hud rounded bg-white/5 px-1.5 py-0.5 text-[7px] text-white/30">observer only</span>}
                        </span>
                        {event.summary && <span className="mt-1 block text-[11px] leading-5 text-white/42">{event.summary}</span>}
                        <span className="mt-1.5 flex gap-3 text-[9px] uppercase tracking-wider text-white/25">
                          <span>{event.runtimeType}</span>
                          <span>{event.actorRole ?? event.actorType}</span>
                          {event.durationMs != null && <span>{formatDuration(event.durationMs)}</span>}
                        </span>
                      </span>
                      <time className="shrink-0 text-[9px] text-white/28">{new Date(event.occurredAt).toLocaleTimeString()}</time>
                    </button>
                  );
                })}
                {visibleEvents.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">Waiting for the first event…</div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-white/[0.015] p-5">
          <div className="flex items-center gap-2">
            <Box size={14} className="text-white/35" />
            <h3 className="hud text-[10px] text-white/50">{detailEvent ? "Event evidence" : "Run context"}</h3>
          </div>
          {detailEvent ? (
            <div className="mt-5 space-y-5">
              <div>
                <div className="text-sm font-medium text-white/80">{detailEvent.title}</div>
                <div className="mt-2 text-xs leading-5 text-white/45">{detailEvent.summary ?? "No operational summary."}</div>
              </div>
              <dl className="space-y-3 text-[11px]">
                {[
                  ["Event", detailEvent.type],
                  ["Runtime", `${detailEvent.runtimeType} · ${detailEvent.runtimeId}`],
                  ["Actor", detailEvent.actorRole ?? detailEvent.actorType],
                  ["Span", detailEvent.spanId],
                  ["Caused by", detailEvent.causationEventId ?? "root/local"],
                  ["Privacy", detailEvent.privacyLevel],
                  ["Accounting", detailEvent.accountingApplied ? "applied at this leaf" : "not counted here"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[82px_1fr] gap-3">
                    <dt className="text-white/28">{label}</dt>
                    <dd className="break-all text-white/58">{value}</dd>
                  </div>
                ))}
              </dl>
              {detailEvent.error && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/8 p-3 text-xs leading-5 text-red-100">{detailEvent.error}</div>
              )}
              {detailEvent.payload != null && (
                <details className="rounded-xl border border-white/8 bg-black/25 p-3" open={detailEvent.visibility !== "sensitive_collapsed"}>
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">
                    Sanitized {detailEvent.visibility === "sensitive_collapsed" ? "· collapsed by default" : "payload"}
                  </summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-white/48">{safeJson(detailEvent.payload)}</pre>
                </details>
              )}
              <button onClick={() => setSelectedEvent(null)} className="text-[10px] text-cyan-200/60 hover:text-cyan-100">Back to run context</button>
            </div>
          ) : selectedRun ? (
            <div className="mt-5 space-y-5">
              <dl className="space-y-3 text-[11px]">
                {[
                  ["Authority", selectedRun.ownerType],
                  ["Owner", selectedRun.ownerRole ?? selectedRun.ownerId ?? "AVA"],
                  ["Trace", selectedRun.traceId],
                  ["Parent", selectedRun.parentRunId ?? "root"],
                  ["Runtime", `${selectedRun.runtimeType} · ${selectedRun.runtimeId}`],
                  ["Outcome", selectedRun.outcome ?? "pending"],
                  ["Privacy", selectedRun.privacyLevel],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[76px_1fr] gap-3">
                    <dt className="text-white/28">{label}</dt>
                    <dd className="break-all text-white/58">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="rounded-xl border border-cyan-300/12 bg-cyan-300/[0.035] p-4">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-100/55"><ShieldCheck size={12} /> Evidence rule</div>
                <p className="mt-2 text-[11px] leading-5 text-white/38">
                  A returned response is not proof of an external outcome. Verification remains explicit and leaf actions are counted only once.
                </p>
              </div>
              {selectedRun.objective && (
                <details className="rounded-xl border border-white/8 bg-black/25 p-3">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">
                    Sanitized request · collapsed by default
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-[10px] leading-5 text-white/48">{selectedRun.objective}</pre>
                </details>
              )}
              {selectedRun.compactSummary && (
                <details className="rounded-xl border border-white/8 bg-black/25 p-3">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-white/40">
                    Compact outcome · collapsed by default
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-[10px] leading-5 text-white/48">{selectedRun.compactSummary}</pre>
                </details>
              )}
              {(selectedRun.errorCount > 0 || selectedRun.retryCount > 0) && (
                <div className="flex gap-2">
                  <span className="rounded-lg bg-red-400/10 px-2 py-1 text-[10px] text-red-200">{selectedRun.errorCount} errors</span>
                  <span className="rounded-lg bg-amber-300/10 px-2 py-1 text-[10px] text-amber-100">{selectedRun.retryCount} retries</span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5 text-xs text-white/30">No run selected.</div>
          )}
          <div className="mt-8 border-t border-white/8 pt-4 text-[9px] leading-5 text-white/25">
            Prompts, responses and diffs are sanitized and collapsed. Credentials, cookies, hidden reasoning and raw audio are never available here.
          </div>
        </aside>
      </div>
    </main>
  );
}
