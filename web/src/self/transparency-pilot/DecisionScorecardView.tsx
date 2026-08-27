import {
  AUTOMATIC_METRICS,
  EXPERIMENT_SPECIFICATION,
  PROVISIONAL_ADOPTION_REQUIREMENTS,
  PROVISIONAL_ROLLBACK_CONDITIONS,
  REVIEW_DIMENSIONS,
  SYNTHETIC_DATA_NOTICE,
  metricNumber,
  type ExperimentRunRecord,
  type ReviewDimension,
  type WorkflowVersion,
} from "./model.js";

const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  correctness: "Correctness",
  evidenceSupport: "Evidence support",
  completeness: "Completeness",
  uncertaintyCalibration: "Uncertainty calibration",
  practicalUsefulness: "Practical usefulness",
};

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function recordsFor(records: readonly ExperimentRunRecord[], version: WorkflowVersion): ExperimentRunRecord[] {
  return records.filter((record) => record.workflowVersion === version);
}

export function DecisionScorecardView({
  records,
  onSelectRun,
}: {
  records: readonly ExperimentRunRecord[];
  onSelectRun: (runId: string) => void;
}) {
  const groups = {
    baseline: recordsFor(records, "baseline"),
    revised: recordsFor(records, "revised"),
  };

  return (
    <section aria-labelledby="pilot-decision-title" data-view="decision" data-record-count={records.length}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="pilot-decision-title" className="text-base font-semibold text-white/90">Executive decision & scorecard</h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-white/50">
            Absolute mock values and every individual run are projected from the shared structured records. No composite score is used.
          </p>
        </div>
        <span className="chip chip-exec">DESIGN ONLY · NO ADOPTION DECISION</span>
      </div>

      <div role="note" className="mt-4 rounded-lg border border-[rgba(255,212,121,.28)] bg-[rgba(255,212,121,.06)] px-4 py-3 text-[11px] text-[var(--ac-exec)]">
        {SYNTHETIC_DATA_NOTICE}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-[11px]">
          <caption className="sr-only">Absolute synthetic scorecard values by workflow version</caption>
          <thead className="hud text-[9px] uppercase tracking-[0.14em] text-white/40">
            <tr className="border-b border-white/10">
              <th className="px-2 py-2">Workflow</th>
              {REVIEW_DIMENSIONS.map((dimension) => <th key={dimension} className="px-2 py-2">{DIMENSION_LABELS[dimension]} /5</th>)}
              <th className="px-2 py-2">Latency ms</th>
              <th className="px-2 py-2">Tokens</th>
              <th className="px-2 py-2">Interventions</th>
              <th className="px-2 py-2">Failures</th>
            </tr>
          </thead>
          <tbody>
            {(["baseline", "revised"] as const).map((version) => {
              const versionRecords = groups[version];
              return (
                <tr key={version} className="border-b border-white/[0.06] text-white/75">
                  <th className="px-2 py-3 capitalize text-white/90">{version}</th>
                  {REVIEW_DIMENSIONS.map((dimension) => (
                    <td key={dimension} className="px-2 py-3 tabular-nums">{mean(versionRecords.map((record) => record.review.ratings[dimension])).toFixed(2)}</td>
                  ))}
                  <td className="px-2 py-3 tabular-nums">{Math.round(mean(versionRecords.map((record) => metricNumber(record, "latencyMs")))).toLocaleString()}</td>
                  <td className="px-2 py-3 tabular-nums">{Math.round(mean(versionRecords.map((record) => metricNumber(record, "tokenUsage")))).toLocaleString()}</td>
                  <td className="px-2 py-3 tabular-nums">{versionRecords.reduce((sum, record) => sum + metricNumber(record, "humanInterventions"), 0)}</td>
                  <td className="px-2 py-3 tabular-nums">{versionRecords.reduce((sum, record) => sum + metricNumber(record, "errorsAndFailures"), 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-white/35">
        Automatic fields represented: {AUTOMATIC_METRICS.join(" · ")}. Cost remains unreported because this synthetic fixture records tokens only.
      </div>

      <div className="mt-6">
        <h4 className="hud text-[10px] tracking-[0.16em] text-white/55">INDIVIDUAL-RUN VARIATION · 24/24 MOCK RECORDS</h4>
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/[0.08]">
          <table className="w-full min-w-[860px] border-collapse text-left text-[10px]">
            <thead className="sticky top-0 bg-[#071016] text-white/45">
              <tr>
                <th className="px-3 py-2">Run</th><th className="px-3 py-2">Task</th><th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Correctness</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2">Completeness</th>
                <th className="px-3 py-2">Uncertainty</th><th className="px-3 py-2">Usefulness</th><th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Failure / intervention</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.runId} className="border-t border-white/[0.06] text-white/65">
                  <td className="px-3 py-2"><button type="button" className="text-[var(--ac)] underline decoration-white/20 underline-offset-2" onClick={() => onSelectRun(record.runId)}>{record.runId}</button></td>
                  <td className="px-3 py-2">{record.taskId}</td><td className="px-3 py-2 capitalize">{record.workflowVersion}</td>
                  {REVIEW_DIMENSIONS.map((dimension) => <td key={dimension} className="px-3 py-2 tabular-nums">{record.review.ratings[dimension]}/5</td>)}
                  <td className="px-3 py-2 tabular-nums">{record.timings.latencyMs.toLocaleString()} ms</td>
                  <td className="px-3 py-2">{record.errors.length} / {metricNumber(record, "humanInterventions")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ThresholdPanel title="PROVISIONAL ADOPTION REQUIREMENTS · AWAITING DESIGN-REVIEW APPROVAL" items={PROVISIONAL_ADOPTION_REQUIREMENTS} tone="live" />
        <ThresholdPanel title="PROVISIONAL ROLLBACK CONDITIONS · AWAITING DESIGN-REVIEW APPROVAL" items={PROVISIONAL_ROLLBACK_CONDITIONS} tone="stop" />
      </div>

      <div className="mt-6 rounded-xl border border-white/[0.08] bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="hud text-[10px] tracking-[0.16em] text-white/55">UNRESOLVED FOR NIKO</h4>
          <span className="text-[10px] text-white/35">No defaults applied · 7 undecided</span>
        </div>
        <ol className="mt-3 grid gap-2 md:grid-cols-2">
          {EXPERIMENT_SPECIFICATION.unresolvedDecisions.map((decision) => (
            <li key={decision.id} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <span className="hud mt-0.5 text-[9px] text-white/35">{decision.id}</span>
              <span className="flex-1 text-[11px] leading-relaxed text-white/70">{decision.question}</span>
              <span className="chip chip-exec shrink-0">{decision.status}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ThresholdPanel({ title, items, tone }: { title: string; items: readonly string[]; tone: "live" | "stop" }) {
  return (
    <section className={`rounded-xl border p-4 ${tone === "live" ? "border-[rgba(57,255,176,.18)] bg-[rgba(57,255,176,.03)]" : "border-[rgba(255,107,107,.2)] bg-[rgba(255,107,107,.03)]"}`}>
      <h4 className={`hud text-[9px] tracking-[0.14em] ${tone === "live" ? "text-[var(--ac-live)]" : "text-[var(--ac-stop)]"}`}>{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((item) => <li key={item} className="flex gap-2 text-[11px] leading-relaxed text-white/70"><span aria-hidden>•</span><span>{item}</span></li>)}
      </ul>
      <div className="mt-3 text-[10px] text-white/35">Display only · cannot trigger an operational action</div>
    </section>
  );
}
