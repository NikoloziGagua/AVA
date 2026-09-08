import { SYNTHETIC_DATA_NOTICE, metricNumber, type ExperimentRunRecord, type WorkflowVersion } from "./model.js";

interface ProjectedStep {
  key: string;
  label: string;
  detail: string;
  failures: number;
  interventions: number;
  recordIds: string[];
}

function projectSteps(records: readonly ExperimentRunRecord[], version: WorkflowVersion): ProjectedStep[] {
  const versionRecords = records.filter((record) => record.workflowVersion === version);
  const toolNames = Array.from(new Set(versionRecords.flatMap((record) => record.toolActivity.map((activity) => activity.tool))));
  const steps: ProjectedStep[] = [
    {
      key: `${version}-agent`,
      label: "Agent starts",
      detail: `${new Set(versionRecords.flatMap((record) => record.agents.map((agent) => agent.role))).size} role · ${versionRecords.length} run records`,
      failures: 0,
      interventions: 0,
      recordIds: versionRecords.map((record) => record.runId),
    },
    ...toolNames.map((tool) => {
      const activities = versionRecords.flatMap((record) => record.toolActivity.filter((activity) => activity.tool === tool));
      return {
        key: `${version}-${tool}`,
        label: tool,
        detail: activities[0]?.purpose ?? "Recorded tool activity",
        failures: activities.filter((activity) => activity.status !== "completed").length,
        interventions: activities.filter((activity) => activity.humanIntervention).length,
        recordIds: activities.map((activity) => activity.id),
      };
    }),
    {
      key: `${version}-decision`,
      label: "Decision recorded",
      detail: `${versionRecords.reduce((sum, record) => sum + record.decisions.length, 0)} traceable decisions with source links`,
      failures: versionRecords.filter((record) => !record.metrics.completion.value).length,
      interventions: versionRecords.reduce((sum, record) => sum + metricNumber(record, "humanInterventions"), 0),
      recordIds: versionRecords.flatMap((record) => record.decisions.map((decision) => decision.id)),
    },
    {
      key: `${version}-output`,
      label: "Output and audit close",
      detail: `${versionRecords.filter((record) => record.metrics.completion.value).length}/${versionRecords.length} synthetic completions`,
      failures: versionRecords.reduce((sum, record) => sum + record.errors.filter((error) => error.severity !== "warning").length, 0),
      interventions: 0,
      recordIds: versionRecords.map((record) => record.runId),
    },
  ];
  return steps;
}

export function WorkflowComparisonView({
  records,
  onSelectRun,
}: {
  records: readonly ExperimentRunRecord[];
  onSelectRun: (runId: string) => void;
}) {
  return (
    <section aria-labelledby="pilot-workflow-title" data-view="workflow" data-record-count={records.length}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="pilot-workflow-title" className="text-base font-semibold text-white/90">Before-and-after workflow</h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-white/50">
            Steps, counts, failures, and interventions are projected from agent, tool, decision, and output records—not maintained as a separate results diagram.
          </p>
        </div>
        <span className="chip chip-exec">SYNTHETIC RECORD PROJECTION</span>
      </div>
      <p role="note" className="mt-4 text-[10px] text-[var(--ac-exec)]">{SYNTHETIC_DATA_NOTICE}</p>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {(["baseline", "revised"] as const).map((version) => {
          const versionRecords = records.filter((record) => record.workflowVersion === version);
          const steps = projectSteps(records, version);
          return (
            <article key={version} className="rounded-xl border border-white/[0.08] bg-black/20 p-4" data-workflow-version={version}>
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
                <div>
                  <h4 className="hud text-[11px] uppercase tracking-[0.16em] text-white/75">{version}</h4>
                  <div className="mt-1 text-[10px] text-white/35">12 mock runs · controlled change {version === "baseline" ? "none" : "pending separate approval"}</div>
                </div>
                <span className={`chip ${version === "baseline" ? "chip-ac" : "chip-exec"}`}>{version === "baseline" ? "before" : "after mock"}</span>
              </div>

              <ol className="mt-4 space-y-2" aria-label={`${version} workflow steps derived from records`}>
                {steps.map((step, index) => (
                  <li key={step.key} className="relative flex gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3" data-provenance-ids={step.recordIds.join(",")}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[rgba(92,242,255,.24)] bg-[rgba(92,242,255,.06)] font-mono text-[9px] text-[var(--ac)]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[11px] font-medium text-white/80">{step.label}</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-white/40">{step.detail}</div>
                      {(step.failures > 0 || step.interventions > 0) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {step.failures > 0 && <span className="chip chip-stop">{step.failures} failure{step.failures === 1 ? "" : "s"}</span>}
                          {step.interventions > 0 && <span className="chip chip-exec">{step.interventions} human intervention{step.interventions === 1 ? "" : "s"}</span>}
                        </div>
                      )}
                    </div>
                    {index < steps.length - 1 && <span aria-hidden className="absolute -bottom-3 left-[23px] h-3 w-px bg-white/15" />}
                  </li>
                ))}
              </ol>

              <div className="mt-4 border-t border-white/[0.07] pt-3">
                <div className="hud text-[9px] tracking-[0.14em] text-white/40">RUN LINKS · TASK / REPLICATE</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {versionRecords.map((record) => (
                    <button key={record.runId} type="button" onClick={() => onSelectRun(record.runId)} className="rounded-md border border-white/[0.09] bg-white/[0.025] px-2 py-1 font-mono text-[9px] text-[var(--ac)] hover:border-[rgba(92,242,255,.35)]">
                      {record.runId}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 rounded-lg border border-[rgba(255,212,121,.2)] bg-[rgba(255,212,121,.04)] px-4 py-3 text-[11px] leading-relaxed text-white/60">
        The revised path is a UI placeholder only. Its controlled change remains undefined, unapproved, and unable to run. The visible differences exercise traceability and failure presentation; they are not benchmark claims.
      </div>
    </section>
  );
}
