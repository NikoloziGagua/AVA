import {
  AlertTriangle,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  Route,
  ShieldQuestion,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  ExplorerLearnedWorkflow,
  ExplorerLearnedWorkflowsResponse,
} from "../api.js";
import {
  formatExplorerDuration,
  formatExplorerTimestamp,
  humanizeExplorerToken,
} from "./task-utils.js";

export interface LearnedWorkflowsViewProps {
  response: ExplorerLearnedWorkflowsResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function storedDate(value: string | null): string {
  if (!value) return "Not recorded";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return formatExplorerTimestamp(timestamp);
}

function successRate(value: number | null): string {
  if (value == null) return "Not measured";
  return `${Math.round(value * 1000) / 10}%`;
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.075] bg-black/24 px-4 py-4">
      <div className="hud text-[8px] text-white/30">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white/78">{value}</div>
      <div className="mt-1 text-[8.5px] leading-relaxed text-white/28">{detail}</div>
    </div>
  );
}

function LearnedWorkflowTree({ workflow }: { workflow: ExplorerLearnedWorkflow }) {
  const steps = [...workflow.steps].sort(
    (left, right) => left.sequence - right.sequence,
  );

  return (
    <div
      role="tree"
      aria-label={`${workflow.trigger} learned workflow`}
      className="rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-5 sm:px-6"
    >
      <div
        role="treeitem"
        aria-level={1}
        aria-label={`Trigger: ${workflow.trigger}`}
        className="mx-auto max-w-xl rounded-2xl border border-[rgba(92,242,255,.38)] bg-[rgba(92,242,255,.075)] px-4 py-4 shadow-[0_0_28px_-16px_rgba(92,242,255,.8)]"
      >
        <div className="flex items-center gap-2">
          <Route size={14} className="text-[var(--ac)]" aria-hidden />
          <span className="hud text-[8px] text-[var(--ac)]">Stored trigger</span>
        </div>
        <div className="mt-2 text-[12px] font-semibold leading-relaxed text-white/82">
          {workflow.trigger}
        </div>
        {workflow.keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {workflow.keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full border border-white/[0.08] bg-black/25 px-2 py-1 text-[8px] text-white/38"
              >
                {keyword}
              </span>
            ))}
          </div>
        )}
      </div>

      {steps.length === 0 ? (
        <>
          <div className="mx-auto h-7 w-px bg-gradient-to-b from-[var(--ac)]/55 to-white/10" aria-hidden />
          <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-[rgba(255,212,121,.24)] bg-[rgba(255,212,121,.045)] px-4 py-4 text-center">
            <ShieldQuestion size={15} className="mx-auto text-[var(--ac-exec)]" aria-hidden />
            <div className="mt-2 text-[10px] font-medium text-white/55">No stored steps</div>
            <p className="mt-1 text-[9px] text-white/32">
              AVA has a durable trigger record, but no executable step sequence is stored.
            </p>
          </div>
        </>
      ) : (
        steps.map((step, index) => (
          <div key={step.id}>
            <div className="mx-auto h-7 w-px bg-gradient-to-b from-[var(--ac)]/55 to-white/12" aria-hidden />
            <div
              role="treeitem"
              aria-level={index + 2}
              aria-label={`Stored step ${step.sequence}: ${step.label}`}
              className="mx-auto max-w-xl rounded-2xl border border-white/[0.1] bg-[linear-gradient(145deg,rgba(255,255,255,.055),rgba(8,11,17,.92))] px-4 py-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(92,242,255,.18)] bg-[rgba(92,242,255,.06)] font-mono text-[9px] text-[var(--ac)]">
                  {step.sequence}
                </div>
                <div className="min-w-0">
                  <div className="hud text-[7px] text-white/28">Stored playbook step</div>
                  <div className="mt-1.5 text-[11px] font-medium leading-relaxed text-white/72">
                    {step.label}
                  </div>
                  <div className="mt-2 font-mono text-[7.5px] text-white/22">
                    source: {step.source}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))
      )}

      <p className="mx-auto mt-4 max-w-xl text-center text-[8.5px] leading-relaxed text-white/26">
        This visualises the stored sequential definition only. Branches, retries,
        tools and verification are not shown unless AVA records them in the playbook.
      </p>
    </div>
  );
}

function WorkflowMetrics({ workflow }: { workflow: ExplorerLearnedWorkflow }) {
  const observed = workflow.evidenceState === "verified_outcomes";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {[
        ["Recalls", String(workflow.metrics.recalls), "Playbook recall counter"],
        ["Evidence", String(workflow.metrics.evidenceOutcomes), "Terminal receipt outcomes"],
        ["Verified", String(workflow.metrics.verifiedRuns), "Independent evidence"],
        ["Unverified", String(workflow.metrics.unverifiedRuns), "Not treated as success"],
        ["Verification rate", successRate(workflow.metrics.verificationRate), observed ? "Verified / evidence outcomes" : "No gate evidence yet"],
        [
          "Verified average",
          formatExplorerDuration(
            workflow.metrics.averageVerifiedDurationMs,
            "Not measured",
          ),
          "Verified recalled runs",
        ],
      ].map(([label, value, detail]) => (
        <div key={label} className="rounded-xl border border-white/[0.07] bg-black/22 px-3 py-3">
          <div className="hud text-[7px] text-white/27">{label}</div>
          <div className="mt-1.5 text-[11px] font-semibold text-white/67">{value}</div>
          <div className="mt-1 text-[7.5px] text-white/24">{detail}</div>
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: ExplorerLearnedWorkflow }) {
  const observed = workflow.evidenceState === "verified_outcomes";
  return (
    <article className="lg-slab overflow-hidden" aria-labelledby={`${workflow.id}-title`}>
      <header className="border-b border-white/[0.07] px-5 py-5 sm:px-7">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="hud text-[8px] text-[var(--ac)]">Durable AVA playbook</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2 py-1 hud text-[7px] text-white/35">
                Revision {workflow.revision}
              </span>
              <span
                className={`rounded-full border px-2 py-1 hud text-[7px] ${
                  workflow.stakes === "consequential"
                    ? "border-[rgba(255,212,121,.22)] bg-[rgba(255,212,121,.06)] text-[var(--ac-exec)]"
                    : "border-white/[0.08] bg-white/[0.025] text-white/38"
                }`}
              >
                {workflow.stakes}
              </span>
            </div>
            <h3 id={`${workflow.id}-title`} className="mt-2 text-lg font-semibold text-white/88">
              {workflow.trigger}
            </h3>
            <div className="mt-1 font-mono text-[8px] text-white/25">{workflow.slug}</div>
          </div>
          <div
            className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[9px] ${
              observed
                ? "border-[rgba(57,255,176,.2)] bg-[rgba(57,255,176,.055)] text-[var(--ac-live)]"
                : "border-[rgba(255,212,121,.18)] bg-[rgba(255,212,121,.045)] text-[var(--ac-exec)]"
            }`}
          >
            {observed ? <CheckCircle2 size={13} aria-hidden /> : <ShieldQuestion size={13} aria-hidden />}
            {observed ? "Observed outcome counters" : "Definition only"}
          </div>
        </div>
        <div className="mt-4">
          <WorkflowMetrics workflow={workflow} />
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,.7fr)]">
        <LearnedWorkflowTree workflow={workflow} />

        <div className="space-y-4">
          <aside
            aria-label={`${workflow.trigger} lessons`}
            className="rounded-2xl border border-[rgba(182,132,255,.2)] bg-[rgba(182,132,255,.045)] px-5 py-5"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-[#c49aff]" aria-hidden />
              <div className="hud text-[8px] text-[#c49aff]">Lessons · not workflow steps</div>
            </div>
            {workflow.lessons.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {workflow.lessons.map((lesson, index) => (
                  <li
                    key={`${index}:${lesson}`}
                    className="flex gap-2 text-[10px] leading-relaxed text-white/52"
                  >
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#c49aff]" />
                    <span>{lesson}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[9px] leading-relaxed text-white/30">
                No separate lesson has been stored for this playbook.
              </p>
            )}
          </aside>

          <section
            aria-label={`${workflow.trigger} provenance`}
            className="rounded-2xl border border-white/[0.08] bg-black/24 px-5 py-5"
          >
            <div className="flex items-center gap-2">
              <Database size={14} className="text-[var(--ac)]" aria-hidden />
              <div className="hud text-[8px] text-white/42">Definition provenance</div>
            </div>
            <dl className="mt-4 space-y-3 text-[9px]">
              {[
                ["Source", humanizeExplorerToken(workflow.provenance.source)],
                ["Source ID", workflow.provenance.sourceId],
                ["Creation method", "Not recorded"],
                ["Created", storedDate(workflow.created)],
                ["Last used", storedDate(workflow.lastUsed)],
                ["Metrics source", humanizeExplorerToken(workflow.provenance.metricsSource)],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-1 sm:grid-cols-[105px_1fr]">
                  <dt className="text-white/27">{label}</dt>
                  <dd className="break-words text-white/52">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-white/[0.06] pt-3 text-[8.5px] leading-relaxed text-white/28">
              {workflow.provenance.note}
            </p>
          </section>

          <section className="rounded-2xl border border-dashed border-white/[0.1] px-5 py-4">
            <div className="hud text-[8px] text-white/35">Links not inferred</div>
            <dl className="mt-3 space-y-3 text-[9px]">
              <div>
                <dt className="text-white/28">Capability links · Not recorded</dt>
                <dd className="mt-1 leading-relaxed text-white/40">{workflow.capabilityMapping.reason}</dd>
              </div>
              <div>
                <dt className="text-white/28">Task links · Not recorded</dt>
                <dd className="mt-1 leading-relaxed text-white/40">{workflow.taskLinkage.reason}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </article>
  );
}

export function LearnedWorkflowsView({
  response,
  loading,
  error,
  onRetry,
}: LearnedWorkflowsViewProps) {
  if (loading && !response) {
    return (
      <section aria-label="Loading learned workflows" className="space-y-4">
        <div className="h-36 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
        <div className="h-96 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    );
  }

  if (error && !response) {
    return (
      <section
        role="alert"
        className="lg-slab flex min-h-80 flex-col items-center justify-center px-6 text-center"
      >
        <AlertTriangle size={26} className="text-[var(--ac-stop)]" aria-hidden />
        <h2 className="mt-4 text-base font-semibold text-white/68">Learned workflows unavailable</h2>
        <p className="mt-2 max-w-xl break-words text-[10px] leading-relaxed text-white/38">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-deck btn-ghost mt-5 flex h-8 items-center gap-2 px-3"
        >
          <RefreshCw size={12} aria-hidden />
          Retry learned workflows
        </button>
      </section>
    );
  }

  if (!response) return null;

  return (
    <section className="space-y-5" aria-labelledby="learned-workflows-heading">
      <div className="lg-slab overflow-hidden px-5 py-5 sm:px-7">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit size={15} className="text-[var(--ac)]" aria-hidden />
              <div className="hud text-[9px] text-[var(--ac)]">Procedural memory</div>
            </div>
            <h2 id="learned-workflows-heading" className="mt-2 text-xl font-semibold text-white/90">
              Workflows AVA has durably learned
            </h2>
            <p className="mt-2 max-w-3xl text-[10.5px] leading-relaxed text-white/40">
              Every card below comes directly from AVA’s local playbook store. The tree shows only
              the stored trigger and ordered steps; lessons, capability links and task evidence are
              deliberately kept separate.
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="btn-deck btn-ghost flex h-8 shrink-0 items-center gap-2 px-3"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden />
            Refresh playbooks
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-6">
          <SummaryMetric label="Stored" value={response.summary.total} detail="Parseable playbooks" />
          <SummaryMetric label="Evidence-backed" value={response.summary.withObservedOutcomes} detail="Have gate outcomes" />
          <SummaryMetric label="Definition only" value={response.summary.definitionOnly} detail="No evidence or legacy reports" />
          <SummaryMetric label="Recalls" value={response.summary.totalRecalls} detail="All playbooks" />
          <SummaryMetric label="Verified" value={response.summary.verifiedRuns} detail="Independent outcome evidence" />
          <SummaryMetric label="Contradicted" value={response.summary.contradictedRuns} detail="Verification disagreed" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.065] pt-4 text-[8.5px] text-white/30">
          <span className="flex items-center gap-1.5">
            <Database size={11} aria-hidden />
            {humanizeExplorerToken(response.source.type)}
          </span>
          <span>{response.source.parsedRecords} parsed</span>
          <span className={response.source.excludedUnparseableRecords ? "text-[var(--ac-exec)]" : ""}>
            {response.source.excludedUnparseableRecords} excluded as unparseable
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Clock3 size={11} aria-hidden />
            Read {formatExplorerTimestamp(response.source.readAt)}
          </span>
        </div>
      </div>

      {error && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-[rgba(255,212,121,.2)] bg-[rgba(255,212,121,.05)] px-4 py-3"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--ac-exec)]" aria-hidden />
          <p className="text-[9px] leading-relaxed text-white/42">
            Refresh failed. Showing the most recent playbook snapshot. {error}
          </p>
        </div>
      )}

      {response.workflows.length === 0 ? (
        <div className="lg-slab flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <BookOpenCheck size={27} className="text-white/24" aria-hidden />
          <h3 className="mt-4 text-sm font-semibold text-white/60">No durable playbooks yet</h3>
          <p className="mt-2 max-w-lg text-[10px] leading-relaxed text-white/32">
            The playbook store was read successfully and contains no parseable workflow records.
            When AVA stores a new procedural playbook, it will appear here on the next automatic refresh.
          </p>
        </div>
      ) : (
        response.workflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))
      )}

      <div className="rounded-2xl border border-white/[0.07] bg-black/22 px-5 py-4">
        <div className="flex items-start gap-3">
          {response.source.excludedUnparseableRecords > 0 ? (
            <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--ac-exec)]" aria-hidden />
          ) : (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--ac-live)]" aria-hidden />
          )}
          <div>
            <div className="hud text-[8px] text-white/38">Coverage boundary</div>
            <p className="mt-2 text-[9px] leading-relaxed text-white/34">
              {response.source.note} {response.coverage.note}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
