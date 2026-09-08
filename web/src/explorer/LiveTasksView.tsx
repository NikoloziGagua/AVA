import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  LoaderCircle,
  Radio,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import {
  fetchExplorerLive,
  type ExplorerLiveTask,
} from "../api.js";
import {
  describeExplorerRequestError,
  formatExplorerDuration,
  formatExplorerTimestamp,
  humanizeExplorerToken,
} from "./task-utils.js";

const DEFAULT_LIVE_REFRESH_MS = 3_000;

export interface LiveTasksViewProps {
  /** Opens the durable Task Inspector record for an instrumented live run. */
  onInspectTask?: (taskId: string) => void;
  /** Set to 0 to disable polling (useful for tests and embedded/static views). */
  refreshIntervalMs?: number;
  className?: string;
}

function LiveTaskCard({
  task,
  onInspectTask,
}: {
  task: ExplorerLiveTask;
  onInspectTask?: (taskId: string) => void;
}) {
  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-[rgba(92,242,255,.18)] px-5 py-5"
      style={{
        background:
          "radial-gradient(circle at 88% 4%, rgba(92,242,255,.1), transparent 34%)," +
          "linear-gradient(145deg, rgba(92,242,255,.05), rgba(255,255,255,.018))",
      }}
    >
      <span
        aria-hidden
        className="absolute right-5 top-5 h-2 w-2 animate-pulse rounded-full bg-[var(--ac-live)]"
        style={{ boxShadow: "0 0 14px rgba(57,255,176,.8)" }}
      />
      <div className="pr-8">
        <div className="flex items-center gap-2 hud text-[8px] tracking-[0.16em] text-[var(--ac-live)]">
          <Radio size={12} aria-hidden />
          Active run
        </div>
        <h3 className="mt-2 truncate text-base font-semibold text-white/88">
          {task.sessionTitle?.trim() || `Task ${task.id.slice(0, 8)}`}
        </h3>
        <div className="mt-1 truncate font-mono text-[9px] text-white/28">{task.id}</div>
      </div>

      <div className="mt-5 rounded-xl border border-white/[0.075] bg-black/25 px-4 py-3">
        <div className="hud text-[8px] tracking-[0.14em] text-white/32">Current stage</div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-white/72">
          <LoaderCircle size={13} className="animate-spin text-[var(--ac-exec)]" aria-hidden />
          <span className="min-w-0 break-words">{task.currentStage}</span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/[0.065] bg-white/[0.018] px-3 py-2.5">
          <dt className="hud text-[7px] tracking-[0.13em] text-white/28">Elapsed</dt>
          <dd className="mt-1 text-[11px] font-semibold text-white/68">
            {formatExplorerDuration(task.elapsedMs, "Not recorded")}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.065] bg-white/[0.018] px-3 py-2.5">
          <dt className="hud text-[7px] tracking-[0.13em] text-white/28">Events</dt>
          <dd className="mt-1 text-[11px] font-semibold text-white/68">{task.eventCount}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.065] bg-white/[0.018] px-3 py-2.5">
          <dt className="hud text-[7px] tracking-[0.13em] text-white/28">Mode</dt>
          <dd className="mt-1 truncate text-[11px] font-semibold text-white/68">
            {task.mode ? humanizeExplorerToken(task.mode) : "Not recorded"}
          </dd>
        </div>
        <div className="rounded-xl border border-white/[0.065] bg-white/[0.018] px-3 py-2.5">
          <dt className="hud text-[7px] tracking-[0.13em] text-white/28">Trace</dt>
          <dd
            className={`mt-1 text-[11px] font-semibold ${
              task.traceAvailable ? "text-[var(--ac-live)]" : "text-white/42"
            }`}
          >
            {task.traceAvailable ? "Available" : "Unavailable"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.065] pt-4">
        <div className="flex items-center gap-1.5 text-[9px] text-white/30">
          <Clock3 size={11} aria-hidden />
          {task.startedAt == null
            ? "Start time not recorded"
            : `Started ${formatExplorerTimestamp(task.startedAt)}`}
        </div>
        {task.traceAvailable && onInspectTask && (
          <button
            type="button"
            onClick={() => onInspectTask(task.id)}
            className="btn-deck btn-ghost flex h-8 items-center gap-2 px-3"
          >
            Inspect trace
            <ArrowUpRight size={12} aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}

export function LiveTasksView({
  onInspectTask,
  refreshIntervalMs = DEFAULT_LIVE_REFRESH_MS,
  className,
}: LiveTasksViewProps) {
  const [tasks, setTasks] = useState<ExplorerLiveTask[]>([]);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetchExplorerLive();
      setTasks(response.tasks);
      setGeneratedAt(response.generatedAt);
      setError(null);
      setHasLoaded(true);
    } catch (loadError) {
      setError(describeExplorerRequestError(loadError, "the live task registry"));
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (refreshIntervalMs <= 0) return;
    const interval = window.setInterval(() => void load(), refreshIntervalMs);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, refreshIntervalMs]);

  return (
    <section className={className} aria-labelledby="live-tasks-heading">
      <div className="lg-slab overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tasks.length ? "animate-pulse bg-[var(--ac-live)]" : "bg-white/25"
                }`}
                style={tasks.length ? { boxShadow: "0 0 10px rgba(57,255,176,.7)" } : undefined}
                aria-hidden
              />
              <h2
                id="live-tasks-heading"
                className="hud text-[10px] tracking-[0.16em] text-white/58"
              >
                Live execution
              </h2>
            </div>
            <p className="mt-2 max-w-xl text-[10px] leading-relaxed text-white/34">
              Directly reported by AVA’s active-run registry. This view does not infer work from chat activity.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {generatedAt != null && (
              <span className="hidden text-[9px] text-white/27 sm:inline">
                Checked {formatExplorerTimestamp(generatedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="btn-deck btn-ghost flex h-8 items-center gap-2 px-2.5"
              aria-label="Refresh live tasks"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden />
              REFRESH
            </button>
          </div>
        </header>

        <div className="px-4 py-4 sm:px-6 sm:py-6" aria-live="polite">
          {loading && !hasLoaded && (
            <div className="grid gap-3 lg:grid-cols-2" aria-label="Loading live tasks">
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="h-60 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]"
                />
              ))}
            </div>
          )}

          {!loading && error && !hasLoaded && (
            <div
              role="alert"
              className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-[rgba(255,107,107,.18)] bg-[rgba(255,107,107,.045)] px-6 text-center"
            >
              <AlertTriangle size={25} className="text-[var(--ac-stop)]" aria-hidden />
              <h3 className="mt-4 text-sm font-semibold text-white/62">
                Live registry unavailable
              </h3>
              <p className="mt-1 max-w-md break-words text-[10px] leading-relaxed text-white/35">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing}
                className="btn-deck btn-ghost mt-4 flex h-8 items-center gap-2 px-3"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden />
                {refreshing ? "Retrying live registry" : "Retry live registry"}
              </button>
            </div>
          )}

          {hasLoaded && tasks.length === 0 && (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-black/20 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.025]">
                <ScanLine size={22} className="text-white/26" aria-hidden />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-white/60">
                No AVA task is running now
              </h3>
              <p className="mt-1 max-w-md text-[10px] leading-relaxed text-white/32">
                This is a confirmed empty active-run registry, not an estimate. Start a new AVA task and its live record will appear here when instrumentation is available.
              </p>
              {error && (
                <p className="mt-3 text-[9px] text-[var(--ac-exec)]/70">
                  The last refresh failed; showing the most recent successful empty result. {error}
                </p>
              )}
            </div>
          )}

          {tasks.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {tasks.map((task) => (
                <LiveTaskCard
                  key={task.id}
                  task={task}
                  onInspectTask={onInspectTask}
                />
              ))}
            </div>
          )}

          {hasLoaded && error && tasks.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[rgba(255,212,121,.16)] bg-[rgba(255,212,121,.04)] px-4 py-3 text-[9px] text-white/40">
              <AlertTriangle size={12} className="shrink-0 text-[var(--ac-exec)]" aria-hidden />
              Live refresh failed. Showing the most recent successful registry result. {error}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
