import { REVIEW_DIMENSIONS, SYNTHETIC_DATA_NOTICE, type ExperimentRunRecord, type ReviewDimension } from "./model.js";

const LABELS: Record<ReviewDimension, string> = {
  correctness: "Correctness",
  evidenceSupport: "Evidence support",
  completeness: "Completeness",
  uncertaintyCalibration: "Uncertainty calibration",
  practicalUsefulness: "Practical usefulness",
};

function valueText(value: number | boolean, unit: string): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (unit === "ratio") return `${value.toFixed(2)} absolute ratio`;
  return `${value.toLocaleString()} ${unit}`;
}

export function RunEvidenceView({
  records,
  selectedRunId,
  onSelectRun,
}: {
  records: readonly ExperimentRunRecord[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}) {
  const record = records.find((candidate) => candidate.runId === selectedRunId) ?? records[0];
  if (!record) return <div role="alert">No synthetic run record is available.</div>;
  const interventions = record.toolActivity.filter((activity) => activity.humanIntervention);

  return (
    <section aria-labelledby="pilot-evidence-title" data-view="evidence" data-record-count={records.length} data-selected-run={record.runId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="pilot-evidence-title" className="text-base font-semibold text-white/90">Evidence & individual-run drill-down</h3>
          <p className="mt-1 text-[11px] text-white/50">One exact task/run projection with linked sources, claims, decisions, failures, approvals, timings, and metric provenance.</p>
        </div>
        <label className="flex items-center gap-2 text-[10px] text-white/45">
          Run ID
          <select aria-label="Selected synthetic run" value={record.runId} onChange={(event) => onSelectRun(event.target.value)} className="rounded-md border border-white/10 bg-[#071016] px-2 py-1.5 font-mono text-[10px] text-white/80">
            {records.map((candidate) => <option key={candidate.runId} value={candidate.runId}>{candidate.runId} · {candidate.taskId} · {candidate.workflowVersion}</option>)}
          </select>
        </label>
      </div>

      <div role="note" className="mt-4 rounded-lg border border-[rgba(255,212,121,.24)] bg-[rgba(255,212,121,.05)] px-4 py-3 text-[11px] text-[var(--ac-exec)]">
        {SYNTHETIC_DATA_NOTICE}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Info label="Task / run" value={`${record.taskId} / ${record.runId}`} />
        <Info label="Workflow / replicate" value={`${record.workflowVersion} / ${record.replicate}`} />
        <Info label="Completion" value={`${String(record.metrics.completion.value)} · ${record.errors.length} error records`} tone={record.metrics.completion.value ? "normal" : "stop"} />
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-4">
        <h4 className="hud text-[9px] tracking-[0.15em] text-white/45">FROZEN PROMPT, INPUT, MODEL & SETTINGS</h4>
        <p className="mt-3 text-[11px] leading-relaxed text-white/75">{record.prompt}</p>
        <dl className="mt-3 grid gap-3 text-[10px] md:grid-cols-2">
          {record.inputs.map((input) => <div key={input.id}><dt className="text-white/35">{input.id} · {input.digest}</dt><dd className="mt-1 text-white/65">{input.label}</dd></div>)}
          <div><dt className="text-white/35">Model / rubric</dt><dd className="mt-1 text-white/65">{record.configuration.model} · {record.configuration.rubricVersion}</dd></div>
          <div><dt className="text-white/35">Settings</dt><dd className="mt-1 break-words font-mono text-white/65">{JSON.stringify(record.configuration.settings)}</dd></div>
        </dl>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DetailPanel title="BLINDED HUMAN REVIEW">
          <div className="text-[10px] text-white/40">{record.review.assignmentId} · {record.review.blindedWorkflowLabel} · randomized order {record.review.randomizedOrder} · {record.review.reviewerAlias}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {REVIEW_DIMENSIONS.map((dimension) => (
              <div key={dimension} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-center">
                <div className="text-lg font-semibold tabular-nums text-white/90">{record.review.ratings[dimension]}<span className="text-xs text-white/35">/5</span></div>
                <div className="mt-1 text-[8px] leading-tight text-white/40">{LABELS[dimension]}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-white/45">{record.review.notes}</p>
        </DetailPanel>

        <DetailPanel title="TIMINGS, AGENTS & HUMAN INTERVENTION">
          <dl className="grid grid-cols-2 gap-2 text-[10px]">
            <div><dt className="text-white/35">Started</dt><dd className="mt-1 text-white/70">{record.timings.startedAt}</dd></div>
            <div><dt className="text-white/35">Ended</dt><dd className="mt-1 text-white/70">{record.timings.endedAt}</dd></div>
            <div><dt className="text-white/35">Absolute latency</dt><dd className="mt-1 text-white/70">{record.timings.latencyMs.toLocaleString()} ms</dd></div>
            <div><dt className="text-white/35">Interventions</dt><dd className={`mt-1 ${interventions.length ? "text-[var(--ac-exec)]" : "text-white/70"}`}>{interventions.length} visible</dd></div>
            <div><dt className="text-white/35">Token usage</dt><dd className="mt-1 text-white/70">{record.usage.inputTokens.toLocaleString()} input + {record.usage.outputTokens.toLocaleString()} output</dd></div>
            <div><dt className="text-white/35">Monetary cost</dt><dd className="mt-1 text-[var(--ac-exec)]">Not reported · no conversion invented</dd></div>
          </dl>
          {record.agents.map((agent) => <div key={agent.id} className="mt-3 rounded-md border border-white/[0.06] px-3 py-2 text-[10px] text-white/55">{agent.id} · {agent.role} · {agent.model}</div>)}
          {interventions.map((activity) => <div key={activity.id} className="mt-2 text-[10px] text-[var(--ac-exec)]">Human intervention at {activity.tool}: {activity.purpose}</div>)}
        </DetailPanel>
      </div>

      <DetailPanel title="ORDERED TOOL ACTIVITY">
        <ol className="grid gap-2 md:grid-cols-3">
          {record.toolActivity.map((activity) => (
            <li key={activity.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[10px]">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[var(--ac)]">{activity.sequence} · {activity.id}</span><span className={`chip ${activity.status === "completed" ? "chip-live" : "chip-stop"}`}>{activity.status}</span></div>
              <div className="mt-2 text-white/75">{activity.tool}</div><div className="mt-1 leading-relaxed text-white/40">{activity.purpose}</div>
              {activity.humanIntervention && <div className="mt-2 text-[var(--ac-exec)]">Human intervention recorded</div>}
              {activity.errorId && <div className="mt-1 text-[var(--ac-stop)]">Error link: {activity.errorId}</div>}
            </li>
          ))}
        </ol>
      </DetailPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailPanel title="SOURCES & CLAIM LINKS">
          <ul className="space-y-2">
            {record.sources.map((source) => <li key={source.id} className="rounded-lg border border-white/[0.06] px-3 py-2 text-[10px]"><div className="font-mono text-[var(--ac)]">{source.id}</div><div className="mt-1 text-white/70">{source.title}</div><div className="mt-1 break-all text-white/35">{source.locator} · {source.authority}</div></li>)}
          </ul>
          <ul className="mt-3 space-y-2">
            {record.claims.map((claim) => <li key={claim.id} className={`rounded-lg border px-3 py-2 text-[10px] ${claim.support === "unsupported" ? "border-[rgba(255,107,107,.25)] bg-[rgba(255,107,107,.04)]" : "border-white/[0.06]"}`}><div className="flex items-center justify-between gap-2"><span className="font-mono text-white/45">{claim.id}</span><span className={`chip ${claim.support === "unsupported" ? "chip-stop" : "chip-ac"}`}>{claim.support}</span></div><div className="mt-2 text-white/70">{claim.text}</div><div className="mt-1 text-white/35">Sources: {claim.sourceIds.join(", ") || "none"} · material {String(claim.material)} · critical {String(claim.critical)}</div></li>)}
          </ul>
        </DetailPanel>

        <DetailPanel title="DECISIONS, OUTPUT, UNCERTAINTY & FAILURES">
          {record.decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-white/[0.06] px-3 py-2 text-[10px]"><div className="font-mono text-[var(--ac)]">{decision.id}</div><div className="mt-2 text-white/75">{decision.summary}</div><div className="mt-1 text-white/45">{decision.rationale}</div><div className="mt-2 text-[var(--ac-exec)]">Uncertainty: {decision.uncertainty}</div><div className="mt-1 text-white/35">Source links: {decision.sourceIds.join(", ")}</div></div>)}
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[10px]"><div className="hud text-[9px] text-white/40">OUTPUT</div><p className="mt-2 text-white/70">{record.output.summary}</p><p className="mt-2 text-white/55">{record.output.recommendation}</p><p className="mt-2 text-[var(--ac-exec)]">{record.output.uncertainty}</p><div className="mt-2 text-white/35">Citations: {record.output.citationIds.join(", ")}</div></div>
          {record.errors.length === 0 ? <div className="mt-3 text-[10px] text-white/40">Failures: 0 structured error records.</div> : record.errors.map((error) => <div key={error.id} className="mt-3 rounded-lg border border-[rgba(255,107,107,.25)] bg-[rgba(255,107,107,.04)] px-3 py-2 text-[10px]"><div className="font-mono text-[var(--ac-stop)]">{error.id} · {error.severity}</div><div className="mt-1 text-white/70">{error.message}</div><div className="mt-1 text-white/40">Stage: {error.stage} · recovered {String(error.recovered)} · intervention {String(error.humanIntervention)}</div></div>)}
        </DetailPanel>
      </div>

      <DetailPanel title="APPROVAL BOUNDARIES">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {record.approvals.map((approval) => <div key={approval.id} className="rounded-lg border border-white/[0.06] px-3 py-2 text-[10px]"><div className="font-mono text-white/40">{approval.id}</div><div className="mt-1 text-white/75">{approval.boundary}</div><div className={`mt-1 ${approval.status === "approved_for_mock" ? "text-[var(--ac-live)]" : "text-[var(--ac-exec)]"}`}>{approval.status}</div><div className="mt-2 leading-relaxed text-white/40">{approval.note}</div></div>)}
        </div>
      </DetailPanel>

      <DetailPanel title="AUTOMATIC METRICS & DERIVATION PROVENANCE">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {Object.values(record.metrics).map((metric) => <div key={metric.name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[10px]"><div className="font-mono text-[var(--ac)]">{metric.name}</div><div className="mt-1 text-sm font-semibold tabular-nums text-white/85">{valueText(metric.value, metric.unit)}</div><div className="mt-2 leading-relaxed text-white/45">{metric.derivation}</div><div className="mt-2 break-words text-white/30">Source: {metric.source} · {metric.sourceRecordIds.join(", ")}</div></div>)}
        </div>
      </DetailPanel>
    </section>
  );
}

function Info({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "stop" }) {
  return <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-3"><div className="hud text-[9px] tracking-[0.14em] text-white/35">{label}</div><div className={`mt-1 text-[11px] ${tone === "stop" ? "text-[var(--ac-stop)]" : "text-white/75"}`}>{value}</div></div>;
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-4"><h4 className="hud text-[9px] tracking-[0.15em] text-white/45">{title}</h4><div className="mt-3">{children}</div></section>;
}
