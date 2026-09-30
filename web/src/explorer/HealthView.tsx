import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TestTube2,
  XCircle,
} from "lucide-react";
import type {
  ExplorerRuntimeCapability,
  ExplorerTaskSummary,
} from "../api.js";
import { formatObservedAt, readinessColor, readinessLabel } from "./runtime.js";

type HealthFilter = "all" | ExplorerRuntimeCapability["readiness"];

function Metric({
  label,
  value,
  detail,
  tone = "var(--ac)",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="lg-slab min-w-0 px-4 py-4">
      <div className="hud text-[8px] text-white/32">{label}</div>
      <div className="mt-2 text-xl font-semibold" style={{ color: tone }}>{value}</div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/34">{detail}</div>
    </div>
  );
}

function percentage(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function HealthView({
  capabilities,
  tasks,
  taskTotal,
  sources,
  generatedAt,
  loading,
  onRefresh,
}: {
  capabilities: readonly ExplorerRuntimeCapability[];
  tasks: readonly ExplorerTaskSummary[];
  taskTotal: number;
  sources: readonly string[];
  generatedAt: number | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<HealthFilter>("all");
  const visible = filter === "all"
    ? capabilities
    : capabilities.filter((capability) => capability.readiness === filter);
  const counts = useMemo(() => ({
    ready: capabilities.filter((item) => item.readiness === "ready").length,
    partial: capabilities.filter((item) => item.readiness === "partially_ready").length,
    setup: capabilities.filter((item) => item.readiness === "setup_required").length,
    unavailable: capabilities.filter((item) => item.readiness === "unavailable").length,
    unknown: capabilities.filter((item) => item.readiness === "unknown").length,
  }), [capabilities]);
  const withFinalResponse = tasks.filter(
    (task) => task.status === "finished" || task.status === "completed",
  ).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const verified = tasks.filter((task) =>
    task.verification.status === "verified" ||
    task.verification.status === "partially_verified",
  ).length;
  const totalToolCalls = tasks.reduce((sum, task) => sum + task.toolCallCount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="hud text-[10px] text-[var(--ac)]">Evidence-based health</div>
          <h2 className="mt-2 text-xl font-semibold text-white/90">Current readiness is not historical reliability.</h2>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/42">
            This view separates today&apos;s configuration and dependency probes from real task outcomes. Unknown stays unknown.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn-deck btn-ghost flex items-center gap-2"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh evidence
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Ready now" value={String(counts.ready)} detail="Direct probe or local-store evidence" tone="var(--ac-live)" />
        <Metric label="Partially ready" value={String(counts.partial)} detail="A dependency or configuration exists" tone="var(--ac-exec)" />
        <Metric label="Needs setup" value={String(counts.setup)} detail="Required configuration is missing" tone="var(--ac-exec)" />
        <Metric label="Unavailable" value={String(counts.unavailable)} detail="A current dependency check failed" tone="var(--ac-stop)" />
        <Metric label="Not measured" value={String(counts.unknown)} detail="No evidence adapter yet" tone="rgba(255,255,255,.48)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac)]">
            <Activity size={15} />
            <span className="hud text-[9px]">Instrumented runs</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white/88">{taskTotal}</div>
          <div className="mt-1 text-[9px] text-white/32">
            Metrics below use the latest {tasks.length} of {taskTotal} recorded runs
          </div>
        </div>
        <div className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac)]">
            <Activity size={15} />
            <span className="hud text-[9px]">Runs with final response</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white/88">{percentage(withFinalResponse, tasks.length)}</div>
          <div className="mt-1 text-[9px] text-white/32">{withFinalResponse} produced a final response · {failed} runtime failures</div>
        </div>
        <div className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac-exec)]">
            <ShieldCheck size={15} />
            <span className="hud text-[9px]">Verification recorded</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white/88">{percentage(verified, tasks.length)}</div>
          <div className="mt-1 text-[9px] text-white/32">A final response alone is not verification</div>
        </div>
        <div className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac)]">
            <Gauge size={15} />
            <span className="hud text-[9px]">Observed tool calls</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white/88">{totalToolCalls}</div>
          <div className="mt-1 text-[9px] text-white/32">From durable, redacted event records</div>
        </div>
      </div>

      <section className="lg-slab px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="hud text-[10px] text-[var(--ac)]">Capability checks</div>
            <div className="mt-1 text-[9px] text-white/30">
              Snapshot {generatedAt ? formatObservedAt(generatedAt) : "not loaded"}
            </div>
          </div>
          <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-black/22 p-1">
            {([
              ["all", "All"],
              ["ready", "Ready"],
              ["partially_ready", "Partial"],
              ["setup_required", "Setup"],
              ["unavailable", "Unavailable"],
              ["unknown", "Unknown"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={
                  "shrink-0 rounded-full px-3 py-1.5 text-[8px] font-semibold transition-colors " +
                  (filter === value
                    ? "bg-[rgba(92,242,255,.12)] text-[var(--ac-text)]"
                    : "text-white/35 hover:text-white/65")
                }
              >
                {label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 divide-y divide-white/[0.055]">
          {visible.map((capability) => {
            const color = readinessColor(capability.readiness);
            const Icon =
              capability.readiness === "ready"
                ? CheckCircle2
                : capability.readiness === "unavailable"
                  ? XCircle
                  : capability.readiness === "unknown"
                    ? CircleHelp
                    : AlertTriangle;
            return (
              <div key={capability.id} className="grid gap-3 py-4 lg:grid-cols-[1.1fr_160px_1.6fr_150px] lg:items-center">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-white/72">{capability.name}</div>
                  <div className="hud mt-1 truncate text-[8px] text-white/25">{capability.moduleReference}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Icon size={13} style={{ color }} />
                  <span className="hud text-[8px]" style={{ color }}>
                    {readinessLabel(capability.readiness)}
                  </span>
                </div>
                <div className="text-[9.5px] leading-relaxed text-white/40">{capability.reason}</div>
                <div className="text-left lg:text-right">
                  <div className="hud text-[8px] text-white/30">{capability.health}</div>
                  <div className="mt-1 text-[8px] text-white/23">{capability.statusConfidence} confidence</div>
                </div>
              </div>
            );
          })}
          {!visible.length && (
            <div className="py-12 text-center text-[10px] text-white/32">No capability has this readiness state.</div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac)]">
            <TestTube2 size={14} />
            <span className="hud text-[9px]">What this release can prove</span>
          </div>
          <div className="mt-4 space-y-2 text-[10px] leading-relaxed text-white/43">
            <p>• Whether configured local dependencies answer their current probe.</p>
            <p>• Which tools and capability identifiers were observed in newly instrumented runs.</p>
            <p>• Whether a run produced a final response, failed, was cancelled, or was interrupted.</p>
            <p>• Sanitised operational inputs and outputs retained for each recorded event.</p>
          </div>
        </section>
        <section className="lg-slab px-5 py-5">
          <div className="flex items-center gap-2 text-[var(--ac-exec)]">
            <CircleHelp size={14} />
            <span className="hud text-[9px]">Still explicitly unknown</span>
          </div>
          <div className="mt-4 space-y-2 text-[10px] leading-relaxed text-white/43">
            <p>• Older task steps, because AVA did not persist them before this instrumentation.</p>
            <p>• Account authentication unless the dedicated workflow checks it directly.</p>
            <p>• Independent success when a tool merely returns without verification evidence.</p>
            <p>• Historical reliability trends until enough newly instrumented runs exist.</p>
          </div>
        </section>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-black/25 px-5 py-4">
        <div className="hud text-[8px] text-white/28">Evidence sources</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {sources.length ? sources.map((source) => (
            <span key={source} className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[8px] text-white/36">
              {source}
            </span>
          )) : <span className="text-[9px] text-white/28">No runtime sources loaded.</span>}
        </div>
      </div>
    </div>
  );
}
