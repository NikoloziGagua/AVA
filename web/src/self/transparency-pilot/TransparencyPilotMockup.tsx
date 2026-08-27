import { useState } from "react";
import { PanelSection } from "../../components/ava/PanelShell.js";
import { DecisionScorecardView } from "./DecisionScorecardView.js";
import { RunEvidenceView } from "./RunEvidenceView.js";
import { WorkflowComparisonView } from "./WorkflowComparisonView.js";
import { SYNTHETIC_RUN_RECORDS } from "./mockRecords.js";
import { EXPERIMENT_SPECIFICATION, SYNTHETIC_DATA_NOTICE, type ExperimentRunRecord } from "./model.js";

type PilotView = "decision" | "workflow" | "evidence";

export function TransparencyPilotMockup({ records = SYNTHETIC_RUN_RECORDS }: { records?: readonly ExperimentRunRecord[] }) {
  const [activeView, setActiveView] = useState<PilotView>("decision");
  const [selectedRunId, setSelectedRunId] = useState(records[0]?.runId ?? "");

  const openRun = (runId: string) => {
    setSelectedRunId(runId);
    setActiveView("evidence");
  };

  return (
    <PanelSection
      title="Transparency pilot · design mock-up"
      span="lg:col-span-12"
      right={<span className="chip chip-exec">READ-ONLY · PROVISIONAL</span>}
    >
      <div data-testid="transparency-pilot" data-record-count={records.length} data-phase={EXPERIMENT_SPECIFICATION.phase}>
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[rgba(92,242,255,.13)] bg-[rgba(4,14,20,.62)] p-4">
          <div className="max-w-3xl">
            <div className="hud text-[10px] tracking-[0.16em] text-[var(--ac)]">MEASUREMENT-FIRST WORKFLOW TRANSPARENCY</div>
            <p className="mt-2 text-[12px] leading-relaxed text-white/70">
              Exactly six frozen tasks, two runs per task per workflow, and 24 planned records across baseline and revised placeholders. This phase designs how evidence will be captured and reviewed; it cannot execute or adopt anything.
            </p>
            <p className="mt-2 text-[10px] text-[var(--ac-exec)]">{SYNTHETIC_DATA_NOTICE}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat value="6" label="frozen tasks" />
            <MiniStat value="2 × 2" label="versions × runs" />
            <MiniStat value="24" label="planned records" />
          </div>
        </div>

        <div role="tablist" aria-label="Transparency pilot views" className="mt-5 flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
          <ViewTab id="decision" label="1 · Decision & scorecard" active={activeView === "decision"} onClick={setActiveView} />
          <ViewTab id="workflow" label="2 · Before / after workflow" active={activeView === "workflow"} onClick={setActiveView} />
          <ViewTab id="evidence" label="3 · Evidence & runs" active={activeView === "evidence"} onClick={setActiveView} />
        </div>

        <div role="tabpanel" className="mt-5">
          {activeView === "decision" && <DecisionScorecardView records={records} onSelectRun={openRun} />}
          {activeView === "workflow" && <WorkflowComparisonView records={records} onSelectRun={openRun} />}
          {activeView === "evidence" && <RunEvidenceView records={records} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />}
        </div>

        <div className="mt-6 rounded-xl border border-white/[0.08] bg-black/20 p-4">
          <div className="hud text-[9px] tracking-[0.15em] text-white/45">LATER GATED COURSE · DOCUMENTED, NOT AUTHORIZED</div>
          <ol className="mt-3 grid gap-2 text-[10px] leading-relaxed text-white/55 md:grid-cols-5">
            {[
              "Freeze and capture baseline after separate approval.",
              "Propose one controlled workflow change for separate approval.",
              "Compare identical tasks, inputs, settings, and rubric.",
              "Present gains, regressions, variation, failures, and evidence.",
              "Ask Niko to adopt, revise, reject, or extend.",
            ].map((step, index) => <li key={step} className="rounded-lg border border-white/[0.06] px-3 py-2"><span className="mr-2 font-mono text-[var(--ac)]">{index + 1}</span>{step}</li>)}
          </ol>
        </div>
      </div>
    </PanelSection>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"><div className="text-base font-semibold text-white/90">{value}</div><div className="mt-1 text-[8px] text-white/35">{label}</div></div>;
}

function ViewTab({ id, label, active, onClick }: { id: PilotView; label: string; active: boolean; onClick: (id: PilotView) => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={() => onClick(id)} className={`rounded-lg border px-3 py-2 text-[10px] transition-colors ${active ? "border-[rgba(92,242,255,.4)] bg-[rgba(92,242,255,.08)] text-[var(--ac)]" : "border-white/[0.08] bg-white/[0.02] text-white/45 hover:border-white/20"}`}>
      {label}
    </button>
  );
}
