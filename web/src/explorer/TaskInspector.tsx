import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleSlash2,
  DatabaseZap,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import {
  fetchExplorerTask,
  fetchExplorerTasks,
  type ExplorerEvent,
  type ExplorerTaskCoverage,
  type ExplorerTaskDetail,
  type ExplorerTaskStatus,
  type ExplorerTaskSummary,
} from "../api.js";
import {
  describeExplorerRequestError,
  explorerTaskTitle,
  explorerTaskStatusLabel,
  filterExplorerTasks,
  formatExplorerDuration,
  formatExplorerTimestamp,
  humanizeExplorerToken,
  selectInitialExplorerEvent,
  stringifyExplorerPayload,
  type ExplorerTaskStatusFilter,
  type ExplorerVerificationFilter,
} from "./task-utils.js";

const DEFAULT_REFRESH_MS = 8_000;
const TASK_PAGE_SIZE = 100;

export interface TaskInspectorProps {
  /** Deep-link to a recorded task. It may be outside the first fetched page. */
  initialTaskId?: string | null;
  /** Opens the matching Atlas capability without coupling this component to routing. */
  onOpenCapability?: (capabilityId: string) => void;
  /** Set to 0 to disable polling (useful for tests and embedded/static views). */
  refreshIntervalMs?: number;
  className?: string;
}

type StatusPresentation = {
  Icon: ComponentType<{ size?: number; className?: string }>;
  className: string;
};

function taskStatusPresentation(status: string): StatusPresentation {
  if (status === "running" || status === "waiting") {
    return {
      Icon: LoaderCircle,
      className: "border-[rgba(255,212,121,.28)] bg-[rgba(255,212,121,.08)] text-[var(--ac-exec)]",
    };
  }
  if (status === "success" || status === "approved") {
    return {
      Icon: CheckCircle2,
      className: "border-[rgba(57,255,176,.25)] bg-[rgba(57,255,176,.07)] text-[var(--ac-live)]",
    };
  }
  if (status === "finished" || status === "completed") {
    return {
      Icon: Activity,
      className: "border-[rgba(92,242,255,.24)] bg-[rgba(92,242,255,.065)] text-[var(--ac-text)]",
    };
  }
  if (
    status === "failed" ||
    status === "error" ||
    status === "denied" ||
    status === "expired"
  ) {
    return {
      Icon: XCircle,
      className: "border-[rgba(255,107,107,.28)] bg-[rgba(255,107,107,.08)] text-[var(--ac-stop)]",
    };
  }
  return {
    Icon: CircleSlash2,
    className: "border-white/[0.1] bg-white/[0.035] text-white/50",
  };
}

function StatusPill({ status, spinning = false }: { status: string; spinning?: boolean }) {
  const { Icon, className } = taskStatusPresentation(status);
  const label = explorerTaskStatusLabel(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 hud text-[8px] tracking-[0.15em] ${className}`}
    >
      <Icon size={11} className={spinning ? "animate-spin" : ""} aria-hidden />
      {label}
    </span>
  );
}

function VerificationPill({
  task,
}: {
  task: Pick<ExplorerTaskSummary, "verification">;
}) {
  const verified = task.verification.status === "verified";
  const partial = task.verification.status === "partially_verified";
  const Icon = verified ? ShieldCheck : ShieldQuestion;
  const className = verified
    ? "border-[rgba(57,255,176,.24)] bg-[rgba(57,255,176,.07)] text-[var(--ac-live)]"
    : partial
      ? "border-[rgba(255,212,121,.24)] bg-[rgba(255,212,121,.07)] text-[var(--ac-exec)]"
      : "border-white/[0.1] bg-white/[0.03] text-white/45";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 hud text-[8px] tracking-[0.14em] ${className}`}
      title={task.verification.reason}
    >
      <Icon size={11} aria-hidden />
      {humanizeExplorerToken(task.verification.status)}
    </span>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-3">
      <div className="hud text-[8px] tracking-[0.15em] text-white/32">{label}</div>
      <div
        className={`mt-1.5 truncate text-sm font-semibold ${warning ? "text-[var(--ac-stop)]" : "text-white/82"}`}
      >
        {value}
      </div>
    </div>
  );
}

function CapabilityChips({
  capabilityIds,
  onOpenCapability,
  compact = false,
}: {
  capabilityIds: readonly string[];
  onOpenCapability?: (capabilityId: string) => void;
  compact?: boolean;
}) {
  if (!capabilityIds.length) {
    return <span className="text-[10px] text-white/30">No capability IDs recorded</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilityIds.map((capabilityId) =>
        onOpenCapability ? (
          <button
            key={capabilityId}
            type="button"
            onClick={() => onOpenCapability(capabilityId)}
            className={`rounded-full border border-[rgba(92,242,255,.16)] bg-[rgba(92,242,255,.055)] text-[var(--ac-text)] transition-colors hover:border-[rgba(92,242,255,.36)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)] ${
              compact ? "px-2 py-0.5 text-[8px]" : "px-2.5 py-1 text-[9px]"
            }`}
          >
            {capabilityId}
          </button>
        ) : (
          <span
            key={capabilityId}
            className={`rounded-full border border-[rgba(92,242,255,.13)] bg-[rgba(92,242,255,.045)] text-[var(--ac-text)]/75 ${
              compact ? "px-2 py-0.5 text-[8px]" : "px-2.5 py-1 text-[9px]"
            }`}
          >
            {capabilityId}
          </span>
        ),
      )}
    </div>
  );
}

function TaskListRow({
  task,
  selected,
  onSelect,
}: {
  task: ExplorerTaskSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`group w-full rounded-2xl border px-4 py-4 text-left transition-[border-color,background,transform] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)] ${
        selected
          ? "border-[rgba(92,242,255,.34)] bg-[rgba(92,242,255,.075)]"
          : "border-white/[0.075] bg-white/[0.022] hover:border-white/[0.14] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white/88">
            {explorerTaskTitle(task)}
          </div>
          <div className="mt-1 truncate hud text-[8px] tracking-[0.13em] text-white/30">
            {task.id}
          </div>
        </div>
        <ChevronRight
          size={15}
          className={`mt-1 shrink-0 transition-transform ${
            selected ? "translate-x-0.5 text-[var(--ac)]" : "text-white/25 group-hover:text-white/55"
          }`}
          aria-hidden
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusPill status={task.status} spinning={task.status === "running"} />
        <VerificationPill task={task} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[9px] text-white/38">
          <strong className="font-medium text-white/65">{task.eventCount}</strong> events
        </span>
        <span className="text-[9px] text-white/38">
          <strong className="font-medium text-white/65">{task.toolCallCount}</strong> tools
        </span>
        <span className={`text-[9px] ${task.errorCount ? "text-[var(--ac-stop)]/75" : "text-white/38"}`}>
          <strong className="font-medium">{task.errorCount}</strong> errors
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-white/30">
        <span className="truncate">{formatExplorerTimestamp(task.startedAt)}</span>
        <span className="shrink-0">
          {formatExplorerDuration(task.durationMs, task.status === "running" ? "Running" : "Not recorded")}
        </span>
      </div>
    </button>
  );
}

function EventStatusIcon({ event }: { event: ExplorerEvent }) {
  if (
    event.status === "error" ||
    event.status === "denied" ||
    event.status === "expired" ||
    event.error
  ) {
    return <XCircle size={15} className="text-[var(--ac-stop)]" aria-hidden />;
  }
  if (event.status === "success" || event.status === "approved") {
    return <CheckCircle2 size={15} className="text-[var(--ac-live)]" aria-hidden />;
  }
  if (event.status === "running" || event.status === "waiting") {
    return <LoaderCircle size={15} className="animate-spin text-[var(--ac-exec)]" aria-hidden />;
  }
  return <Circle size={13} className="text-white/35" aria-hidden />;
}

function Timeline({
  events,
  selectedEventId,
  onSelectEvent,
}: {
  events: readonly ExplorerEvent[];
  selectedEventId: number | null;
  onSelectEvent: (eventId: number) => void;
}) {
  if (!events.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.1] bg-black/20 px-5 py-12 text-center">
        <Activity size={22} className="mx-auto text-white/25" aria-hidden />
        <div className="mt-3 text-xs font-medium text-white/55">No events were recorded</div>
        <p className="mx-auto mt-1 max-w-sm text-[10px] leading-relaxed text-white/32">
          Explorer will not reconstruct missing steps from conversation prose.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-1" aria-label="Recorded execution timeline">
      <span
        aria-hidden
        className="absolute bottom-5 left-[17px] top-5 w-px bg-gradient-to-b from-[rgba(92,242,255,.35)] via-white/10 to-transparent"
      />
      {events.map((event) => {
        const selected = event.id === selectedEventId;
        return (
          <li key={event.id} className="relative">
            <button
              type="button"
              onClick={() => onSelectEvent(event.id)}
              aria-current={selected ? "step" : undefined}
              className={`relative z-[1] flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)] ${
                selected
                  ? "border-[rgba(92,242,255,.3)] bg-[rgba(92,242,255,.07)]"
                  : "border-transparent bg-transparent hover:border-white/[0.08] hover:bg-white/[0.025]"
              }`}
            >
              <span
                data-event-status={event.status}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-[#090c12]"
              >
                <EventStatusIcon event={event} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <span className="text-[11px] font-medium leading-snug text-white/78">
                    {event.title}
                  </span>
                  <span className="hud shrink-0 text-[8px] tracking-[0.12em] text-white/30">
                    #{event.sequence}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-white/35">
                  <span>{humanizeExplorerToken(event.type)}</span>
                  <span aria-hidden>·</span>
                  <span>{formatExplorerTimestamp(event.occurredAt)}</span>
                  {event.durationMs != null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{formatExplorerDuration(event.durationMs)}</span>
                    </>
                  )}
                </span>
                {event.toolName && (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] text-[var(--ac)]/65">
                    <TerminalSquare size={10} aria-hidden />
                    {event.toolName}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PayloadBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <details className="group rounded-xl border border-white/[0.075] bg-black/25">
      <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ac)]">
        <span className="flex items-center justify-between gap-3">
          <span className="hud text-[8px] tracking-[0.15em] text-white/45">{label}</span>
          <ChevronRight
            size={13}
            className="text-white/28 transition-transform group-open:rotate-90"
            aria-hidden
          />
        </span>
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-white/[0.06] px-4 py-3 font-mono text-[10px] leading-relaxed text-white/55">
        {stringifyExplorerPayload(value)}
      </pre>
    </details>
  );
}

function EventInspector({
  event,
  onOpenCapability,
}: {
  event: ExplorerEvent | null;
  onOpenCapability?: (capabilityId: string) => void;
}) {
  if (!event) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-white/[0.09] bg-black/20 px-6 text-center text-[10px] text-white/35">
        Select a recorded event to inspect its evidence and technical details.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.085] bg-black/25 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="hud text-[8px] tracking-[0.15em] text-[var(--ac)]/65">
            Event #{event.sequence}
          </div>
          <h4 className="mt-1 text-sm font-semibold leading-snug text-white/88">{event.title}</h4>
        </div>
        <StatusPill
          status={event.status}
          spinning={event.status === "running" || event.status === "waiting"}
        />
      </div>

      <dl className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2">
          <dt className="text-white/30">Type</dt>
          <dd className="mt-0.5 text-white/65">{humanizeExplorerToken(event.type)}</dd>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2">
          <dt className="text-white/30">Duration</dt>
          <dd className="mt-0.5 text-white/65">{formatExplorerDuration(event.durationMs)}</dd>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2">
          <dt className="text-white/30">Tool</dt>
          <dd className="mt-0.5 break-words text-white/65">{event.toolName ?? "No tool recorded"}</dd>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2">
          <dt className="text-white/30">Privacy</dt>
          <dd className="mt-0.5 text-white/65">{humanizeExplorerToken(event.privacyLevel)}</dd>
        </div>
      </dl>

      {event.error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-[rgba(255,107,107,.22)] bg-[rgba(255,107,107,.065)] px-4 py-3"
        >
          <div className="flex items-center gap-2 hud text-[8px] tracking-[0.14em] text-[var(--ac-stop)]">
            <FileWarning size={12} aria-hidden />
            Recorded error
          </div>
          <p className="mt-2 break-words text-[10px] leading-relaxed text-[#ffc1c1]/75">{event.error}</p>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-[rgba(57,255,176,.13)] bg-[rgba(57,255,176,.035)] px-4 py-3">
        <div className="flex items-center gap-2 hud text-[8px] tracking-[0.14em] text-[var(--ac-live)]/75">
          <DatabaseZap size={12} aria-hidden />
          Recorded evidence
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-white/55">{event.evidence.proves}</p>
        <p className="mt-1 text-[9px] text-white/30">
          Verification: {humanizeExplorerToken(event.evidence.verification)}
        </p>
      </div>

      {event.capabilityIds.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 hud text-[8px] tracking-[0.14em] text-white/35">
            Capabilities
          </div>
          <CapabilityChips
            capabilityIds={event.capabilityIds}
            onOpenCapability={onOpenCapability}
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        <PayloadBlock label="Sanitised input" value={event.input} />
        <PayloadBlock label="Sanitised output" value={event.output} />
      </div>
    </div>
  );
}

function CoverageNotice({ coverage }: { coverage: ExplorerTaskCoverage }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,212,121,.18)] bg-[rgba(255,212,121,.045)] px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--ac-exec)]" aria-hidden />
        <div>
          <div className="hud text-[8px] tracking-[0.14em] text-[var(--ac-exec)]/85">
            Recorded coverage only
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/45">{coverage.note}</p>
          {!coverage.historicalBackfill && (
            <p className="mt-1 text-[9px] leading-relaxed text-white/28">
              Earlier activity is not reconstructed from chat prose.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskDetailView({
  task,
  selectedEventId,
  onSelectEvent,
  onOpenCapability,
}: {
  task: ExplorerTaskDetail;
  selectedEventId: number | null;
  onSelectEvent: (eventId: number) => void;
  onOpenCapability?: (capabilityId: string) => void;
}) {
  const selectedEvent =
    task.events.find((event) => event.id === selectedEventId) ?? null;
  const verificationWarning = task.verification.status !== "verified";

  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-white/[0.07] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="hud text-[8px] tracking-[0.16em] text-[var(--ac)]/65">
            Execution record
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight text-white/92">
            {explorerTaskTitle(task)}
          </h2>
          <div className="mt-2 break-all font-mono text-[9px] text-white/27">{task.id}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <StatusPill status={task.status} spinning={task.status === "running"} />
          <VerificationPill task={task} />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/[0.075] bg-white/[0.022] px-4 py-4 sm:px-5">
        <div className="hud text-[8px] tracking-[0.15em] text-white/35">Original request</div>
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-white/68">
          {task.originalRequest || "No original request was recorded."}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Duration" value={formatExplorerDuration(task.durationMs, task.status === "running" ? "Running" : "Not recorded")} />
        <Metric label="Events" value={task.eventCount} />
        <Metric label="Tool calls" value={task.toolCallCount} />
        <Metric label="Errors" value={task.errorCount} warning={task.errorCount > 0} />
        <Metric label="Started" value={formatExplorerTimestamp(task.startedAt)} />
        <Metric
          label="Mode"
          value={task.mode ? humanizeExplorerToken(task.mode) : "Not recorded"}
        />
      </div>

      {(verificationWarning || task.errorCount > 0) && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {verificationWarning && (
            <div
              className="rounded-xl border border-[rgba(255,212,121,.19)] bg-[rgba(255,212,121,.05)] px-4 py-3"
              role="note"
            >
              <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--ac-exec)]">
                <ShieldQuestion size={13} aria-hidden />
                {humanizeExplorerToken(task.verification.status)}
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-white/42">
                {task.verification.reason}
              </p>
            </div>
          )}
          {task.errorCount > 0 && (
            <div
              className="rounded-xl border border-[rgba(255,107,107,.19)] bg-[rgba(255,107,107,.05)] px-4 py-3"
              role="note"
            >
              <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--ac-stop)]">
                <AlertTriangle size={13} aria-hidden />
                {task.errorCount} recorded {task.errorCount === 1 ? "error" : "errors"}
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-white/42">
                Open affected timeline events for the captured error details.
              </p>
            </div>
          )}
        </div>
      )}

      {(task.outcome || task.capabilityIds.length > 0) && (
        <div className="mt-5 grid gap-4 border-y border-white/[0.065] py-4 sm:grid-cols-2">
          {task.outcome && (
            <div>
              <div className="hud text-[8px] tracking-[0.14em] text-white/32">Outcome</div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/60">
                {humanizeExplorerToken(task.outcome)}
              </p>
            </div>
          )}
          {task.capabilityIds.length > 0 && (
            <div>
              <div className="hud text-[8px] tracking-[0.14em] text-white/32">
                Capabilities observed
              </div>
              <div className="mt-2">
                <CapabilityChips
                  capabilityIds={task.capabilityIds}
                  onOpenCapability={onOpenCapability}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,.95fr)_minmax(320px,1.05fr)]">
        <section aria-labelledby="task-timeline-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3
              id="task-timeline-heading"
              className="hud text-[9px] tracking-[0.16em] text-white/48"
            >
              Recorded timeline
            </h3>
            <span className="text-[9px] text-white/27">{task.events.length} events</span>
          </div>
          <Timeline
            events={task.events}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
          />
        </section>
        <section aria-labelledby="event-inspector-heading">
          <h3
            id="event-inspector-heading"
            className="mb-3 hud text-[9px] tracking-[0.16em] text-white/48"
          >
            Step evidence
          </h3>
          <EventInspector event={selectedEvent} onOpenCapability={onOpenCapability} />
        </section>
      </div>

      {task.finalResponse != null && (
        <details className="group mt-6 rounded-2xl border border-white/[0.075] bg-white/[0.018]">
          <summary className="cursor-pointer list-none px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ac)]">
            <span className="flex items-center justify-between gap-3">
              <span className="hud text-[9px] tracking-[0.15em] text-white/45">
                Final response
              </span>
              <ChevronRight
                size={14}
                className="text-white/30 transition-transform group-open:rotate-90"
                aria-hidden
              />
            </span>
          </summary>
          <p className="whitespace-pre-wrap border-t border-white/[0.06] px-5 py-4 text-[11px] leading-relaxed text-white/58">
            {task.finalResponse}
          </p>
        </details>
      )}

      <div className="mt-4">
        <CoverageNotice coverage={task.coverage} />
      </div>
    </div>
  );
}

export function TaskInspector({
  initialTaskId = null,
  onOpenCapability,
  refreshIntervalMs = DEFAULT_REFRESH_MS,
  className,
}: TaskInspectorProps) {
  const [tasks, setTasks] = useState<ExplorerTaskSummary[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [hasMoreTasks, setHasMoreTasks] = useState(false);
  const [coverage, setCoverage] = useState<ExplorerTaskCoverage | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [selectedTask, setSelectedTask] = useState<ExplorerTaskDetail | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<ExplorerTaskStatusFilter>("all");
  const [verificationFilter, setVerificationFilter] =
    useState<ExplorerVerificationFilter>("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const loadedTaskCount = useRef(0);
  const loadedTasks = useRef<ExplorerTaskSummary[]>([]);

  const loadTasks = useCallback(async (
    mode: "initial" | "refresh" | "append" = "refresh",
  ) => {
    if (mode === "initial") {
      setLoading(true);
      setListError(null);
    }
    if (mode === "refresh") setRefreshing(true);
    if (mode === "append") setLoadingMore(true);
    try {
      const response = await fetchExplorerTasks({
        limit: TASK_PAGE_SIZE,
        offset: mode === "append" ? loadedTaskCount.current : 0,
      });
      const ordered =
        mode === "initial"
          ? response.tasks
          : mode === "append"
            ? [...loadedTasks.current, ...response.tasks]
            : [...response.tasks, ...loadedTasks.current];
      const seen = new Set<string>();
      const next = ordered.filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      });
      loadedTasks.current = next;
      loadedTaskCount.current = next.length;
      setTasks(next);
      setHasMoreTasks(next.length < response.total);
      setTaskTotal(response.total);
      setCoverage(response.coverage);
      setListError(null);
      setSelectedTaskId((current) => current ?? response.tasks[0]?.id ?? null);
    } catch (error) {
      setListError(describeExplorerRequestError(error, "task history"));
    } finally {
      setLoading(false);
      if (mode === "refresh") setRefreshing(false);
      if (mode === "append") setLoadingMore(false);
    }
  }, []);

  const loadTaskDetail = useCallback(async (taskId: string, quiet = false) => {
    const requestId = ++detailRequest.current;
    if (!quiet) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const response = await fetchExplorerTask(taskId);
      if (requestId !== detailRequest.current) return;
      setSelectedTask(response.task);
      setDetailError(null);
      setSelectedEventId((current) => {
        if (response.task.events.some((event) => event.id === current)) return current;
        return selectInitialExplorerEvent(response.task.events)?.id ?? null;
      });
    } catch (error) {
      if (requestId !== detailRequest.current) return;
      if (!quiet) {
        setSelectedTask(null);
        setSelectedEventId(null);
      }
      setDetailError(describeExplorerRequestError(error, "this task record"));
    } finally {
      if (requestId === detailRequest.current && !quiet) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedTaskId(initialTaskId);
  }, [initialTaskId]);

  useEffect(() => {
    void loadTasks("initial");
  }, [loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      setSelectedEventId(null);
      setDetailError(null);
      return;
    }
    setSelectedTask((current) => (current?.id === selectedTaskId ? current : null));
    setSelectedEventId(null);
    void loadTaskDetail(selectedTaskId);
  }, [loadTaskDetail, selectedTaskId]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const refresh = () => {
      void loadTasks("refresh");
      if (selectedTaskId) void loadTaskDetail(selectedTaskId, true);
    };
    const interval = window.setInterval(refresh, refreshIntervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadTaskDetail, loadTasks, refreshIntervalMs, selectedTaskId]);

  const filteredTasks = useMemo(
    () =>
      filterExplorerTasks(
        tasks,
        deferredQuery,
        statusFilter,
        verificationFilter,
      ),
    [deferredQuery, statusFilter, tasks, verificationFilter],
  );

  const refresh = () => {
    void loadTasks("refresh");
    if (selectedTaskId) void loadTaskDetail(selectedTaskId, true);
  };

  return (
    <section
      className={`space-y-4 ${className ?? ""}`}
      aria-label="AVA task inspector"
    >
      {coverage && <CoverageNotice coverage={coverage} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(285px,.72fr)_minmax(0,1.55fr)]">
        <aside className="lg-slab overflow-hidden" aria-label="Recorded task list">
          <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="hud text-[9px] tracking-[0.16em] text-white/55">
                  Recorded tasks
                </div>
                <div className="mt-1 text-[9px] text-white/30">
                  {filteredTasks.length} matching · {tasks.length} of {taskTotal} loaded
                </div>
              </div>
              <button
                type="button"
                onClick={refresh}
                className="btn-deck btn-ghost flex h-8 items-center gap-2 px-2.5"
                aria-label="Refresh recorded tasks"
                disabled={refreshing}
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden />
                <span className="hidden sm:inline">REFRESH</span>
              </button>
            </div>

            <div className="relative mt-4">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/28"
                aria-hidden
              />
              <label htmlFor="explorer-task-search" className="sr-only">
                Search recorded tasks
              </label>
              <input
                id="explorer-task-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks or capabilities…"
                className="h-10 w-full rounded-xl border border-white/[0.09] bg-black/25 pl-9 pr-3 text-[11px] text-white/75 outline-none placeholder:text-white/25 focus:border-[rgba(92,242,255,.35)] focus:ring-1 focus:ring-[rgba(92,242,255,.18)]"
              />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="explorer-task-status">
                Filter by task status
              </label>
              <select
                id="explorer-task-status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ExplorerTaskStatusFilter)
                }
                className="h-9 rounded-xl border border-white/[0.08] bg-[#090c12] px-3 text-[9px] text-white/58 outline-none focus:border-[rgba(92,242,255,.35)]"
              >
                <option value="all">All statuses</option>
                {(["running", "finished", "completed", "failed", "cancelled", "interrupted"] satisfies ExplorerTaskStatus[]).map(
                  (status) => (
                    <option key={status} value={status}>
                      {explorerTaskStatusLabel(status)}
                    </option>
                  ),
                )}
              </select>
              <label className="sr-only" htmlFor="explorer-task-verification">
                Filter by verification
              </label>
              <select
                id="explorer-task-verification"
                value={verificationFilter}
                onChange={(event) =>
                  setVerificationFilter(event.target.value as ExplorerVerificationFilter)
                }
                className="h-9 rounded-xl border border-white/[0.08] bg-[#090c12] px-3 text-[9px] text-white/58 outline-none focus:border-[rgba(92,242,255,.35)]"
              >
                <option value="all">All verification</option>
                <option value="verified">Verified</option>
                <option value="partially_verified">Partially verified</option>
                <option value="not_verified">Not verified</option>
                <option value="not_recorded">Not recorded</option>
              </select>
            </div>
          </div>

          <div className="no-scrollbar max-h-[68vh] space-y-2 overflow-y-auto px-3 py-3 sm:px-4">
            {listError && tasks.length > 0 && (
              <div
                role="status"
                className="rounded-xl border border-[rgba(255,212,121,.16)] bg-[rgba(255,212,121,.04)] px-3 py-2 text-[9px] leading-relaxed text-white/40"
              >
                Refresh failed. Showing the most recent recorded task list. {listError}
              </div>
            )}
            {loading && tasks.length === 0 && (
              <div aria-label="Loading recorded tasks" className="space-y-2">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]"
                  />
                ))}
              </div>
            )}

            {!loading && listError && tasks.length === 0 && (
              <div
                role="alert"
                className="rounded-2xl border border-[rgba(255,107,107,.2)] bg-[rgba(255,107,107,.055)] px-4 py-8 text-center"
              >
                <AlertTriangle size={20} className="mx-auto text-[var(--ac-stop)]" aria-hidden />
                <div className="mt-3 text-xs font-medium text-white/65">Task records unavailable</div>
                <p className="mt-1 break-words text-[9px] leading-relaxed text-white/35">{listError}</p>
                <button
                  type="button"
                  onClick={() => void loadTasks("initial")}
                  className="btn-deck btn-ghost mx-auto mt-4 flex h-8 items-center gap-2 px-3"
                >
                  <RefreshCw size={12} aria-hidden />
                  Retry task history
                </button>
              </div>
            )}

            {!loading && !listError && tasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/[0.1] bg-black/20 px-5 py-12 text-center">
                <Activity size={23} className="mx-auto text-white/24" aria-hidden />
                <div className="mt-3 text-xs font-medium text-white/55">
                  No instrumented tasks yet
                </div>
                <p className="mx-auto mt-1 max-w-xs text-[9px] leading-relaxed text-white/30">
                  New AVA runs will appear here when the runtime emits a durable task trace.
                </p>
              </div>
            )}

            {tasks.length > 0 && filteredTasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/[0.09] px-4 py-10 text-center text-[10px] text-white/35">
                No recorded task matches these filters.
              </div>
            )}

            {filteredTasks.map((task) => (
              <TaskListRow
                key={task.id}
                task={task}
                selected={selectedTaskId === task.id}
                onSelect={() => setSelectedTaskId(task.id)}
              />
            ))}

            {hasMoreTasks && (
              <button
                type="button"
                onClick={() => void loadTasks("append")}
                disabled={loadingMore}
                className="btn-deck btn-ghost flex w-full items-center justify-center gap-2 py-3"
              >
                <RefreshCw
                  size={12}
                  className={loadingMore ? "animate-spin" : ""}
                  aria-hidden
                />
                {loadingMore
                  ? "Loading older tasks"
                  : `Load older tasks (${Math.max(0, taskTotal - tasks.length)} remaining)`}
              </button>
            )}

            {hasMoreTasks && deferredQuery.trim() && (
              <p className="px-2 pb-2 text-center text-[8px] leading-relaxed text-white/28">
                Search currently covers the {tasks.length} loaded tasks. Load older tasks to expand it.
              </p>
            )}
          </div>
        </aside>

        <div className="lg-slab min-w-0 px-4 py-5 sm:px-6 sm:py-6">
          {!selectedTaskId && !loading && (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <Activity size={28} className="text-white/22" aria-hidden />
              <h2 className="mt-4 text-sm font-semibold text-white/58">Select a recorded task</h2>
              <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-white/30">
                Its real event timeline, evidence, errors and verification state will appear here.
              </p>
            </div>
          )}

          {selectedTaskId && detailLoading && !selectedTask && (
            <div
              className="flex min-h-[420px] flex-col items-center justify-center"
              aria-label="Loading task detail"
            >
              <LoaderCircle size={25} className="animate-spin text-[var(--ac)]" aria-hidden />
              <div className="mt-3 hud text-[9px] tracking-[0.16em] text-white/35">
                Reading execution record
              </div>
            </div>
          )}

          {selectedTaskId && detailError && !selectedTask && (
            <div
              role="alert"
              className="flex min-h-[420px] flex-col items-center justify-center text-center"
            >
              <AlertTriangle size={25} className="text-[var(--ac-stop)]" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-white/62">
                Execution record unavailable
              </h2>
              <p className="mt-1 max-w-md break-words text-[10px] leading-relaxed text-white/35">
                {detailError}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadTaskDetail(selectedTaskId)}
                  className="btn-deck btn-ghost flex h-8 items-center gap-2 px-3"
                >
                  <RefreshCw size={12} aria-hidden />
                  Retry task record
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTaskId(null)}
                  className="btn-deck btn-ghost h-8 px-3"
                >
                  Back to task list
                </button>
              </div>
            </div>
          )}

          {selectedTask && (
            <>
              {detailError && (
                <div
                  role="status"
                  className="mb-4 rounded-xl border border-[rgba(255,212,121,.16)] bg-[rgba(255,212,121,.04)] px-4 py-3 text-[9px] leading-relaxed text-white/40"
                >
                  Detail refresh failed. Showing the most recent durable record. {detailError}
                </div>
              )}
              <TaskDetailView
                task={selectedTask}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
                onOpenCapability={onOpenCapability}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
