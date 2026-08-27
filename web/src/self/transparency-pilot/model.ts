export const TASK_IDS = ["T01", "T02", "T03", "T04", "T05", "T06"] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const WORKFLOW_VERSIONS = ["baseline", "revised"] as const;
export type WorkflowVersion = (typeof WORKFLOW_VERSIONS)[number];

export const REVIEW_DIMENSIONS = [
  "correctness",
  "evidenceSupport",
  "completeness",
  "uncertaintyCalibration",
  "practicalUsefulness",
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export const AUTOMATIC_METRICS = [
  "completion",
  "latencyMs",
  "tokenUsage",
  "toolCalls",
  "humanInterventions",
  "errorsAndFailures",
  "citationCoverage",
  "unsupportedMaterialClaims",
] as const;
export type AutomaticMetricName = (typeof AUTOMATIC_METRICS)[number];

export const SYNTHETIC_DATA_NOTICE =
  "Synthetic mock data for design review only — not observed benchmark results.";

export const PROVISIONAL_ADOPTION_REQUIREMENTS = [
  "No critical unsupported claims.",
  "No meaningful decline in any core quality dimension.",
  "Complete, traceable audit records.",
  "At least one material benefit: either a 15% improvement in latency, cost, intervention, or failure rate; or a clear improvement under blinded quality review.",
] as const;

export const PROVISIONAL_ROLLBACK_CONDITIONS = [
  "Missing or unreliable traceability.",
  "Increased critical failures.",
  "A decline of 0.5 or more on any five-point core-quality dimension.",
] as const;

export const UNRESOLVED_DECISIONS = [
  "Are six tasks and 24 runs proportionate?",
  "Which outcomes matter most?",
  "Can unchanged quality plus material efficiency justify adoption?",
  "Who performs the blinded review?",
  "How much technical detail belongs in the executive view?",
  "Do critical unsupported claims automatically reject adoption?",
  "Are the 15% benefit and 0.5-point rollback thresholds approved?",
] as const;

export interface FrozenTask {
  id: TaskId;
  title: string;
  category: "comparison" | "discovery" | "due_diligence" | "evidence_synthesis";
  additionalCoverage?: "comparison" | "discovery" | "due_diligence" | "evidence_synthesis";
  prompt: string;
  inputPacketId: string;
  inputDescription: string;
  evidenceObligations: readonly string[];
  rationale: string;
  frozen: true;
}

export interface WorkflowConfiguration {
  version: WorkflowVersion;
  model: string;
  settings: Readonly<Record<string, string | number | boolean>>;
  rubricVersion: string;
  controlledChange: "none" | "pending-separate-approval";
}

export interface ReviewScore {
  reviewerAlias: string;
  assignmentId: string;
  blindedWorkflowLabel: string;
  randomizedOrder: number;
  ratings: Record<ReviewDimension, 1 | 2 | 3 | 4 | 5>;
  notes: string;
}

export interface AgentRecord {
  id: string;
  role: string;
  model: string;
  startedAt: string;
  endedAt: string;
}

export interface ToolActivityRecord {
  id: string;
  sequence: number;
  tool: string;
  purpose: string;
  status: "completed" | "failed" | "blocked";
  startedAt: string;
  endedAt: string;
  humanIntervention: boolean;
  errorId?: string;
}

export interface SourceRecord {
  id: string;
  title: string;
  locator: string;
  authority: "primary" | "secondary" | "provided_packet";
  retrievedAt: string;
}

export interface ClaimRecord {
  id: string;
  text: string;
  material: boolean;
  critical: boolean;
  sourceIds: string[];
  support: "supported" | "partial" | "unsupported";
}

export interface DecisionRecord {
  id: string;
  sequence: number;
  summary: string;
  rationale: string;
  sourceIds: string[];
  uncertainty: string;
}

export interface ErrorRecord {
  id: string;
  stage: string;
  message: string;
  severity: "warning" | "failure" | "critical";
  recovered: boolean;
  humanIntervention: boolean;
}

export interface TimingRecord {
  id: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
}

export interface UsageRecord {
  id: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  monetaryCost: number | null;
  currency: string | null;
}

export interface ApprovalRecord {
  id: string;
  boundary: "design_mock" | "baseline" | "controlled_change" | "adoption";
  status: "approved_for_mock" | "not_requested" | "not_authorized";
  actor: string;
  recordedAt: string;
  note: string;
}

export interface MetricProvenance {
  name: AutomaticMetricName;
  value: number | boolean;
  unit: "boolean" | "ms" | "tokens" | "count" | "ratio";
  source: "run_record" | "timing_events" | "usage_record" | "tool_activity" | "claim_source_links";
  derivation: string;
  sourceRecordIds: string[];
}

export interface ExperimentRunRecord {
  schemaVersion: "transparency-pilot/1.0";
  synthetic: true;
  syntheticNotice: typeof SYNTHETIC_DATA_NOTICE;
  runId: string;
  taskId: TaskId;
  replicate: 1 | 2;
  workflowVersion: WorkflowVersion;
  prompt: string;
  inputs: Array<{ id: string; label: string; digest: string }>;
  configuration: WorkflowConfiguration;
  agents: AgentRecord[];
  toolActivity: ToolActivityRecord[];
  sources: SourceRecord[];
  claims: ClaimRecord[];
  decisions: DecisionRecord[];
  output: {
    summary: string;
    recommendation: string;
    uncertainty: string;
    citationIds: string[];
  };
  errors: ErrorRecord[];
  timings: TimingRecord;
  usage: UsageRecord;
  approvals: ApprovalRecord[];
  review: ReviewScore;
  metrics: Record<AutomaticMetricName, MetricProvenance>;
}

export interface ExperimentSpecification {
  phase: "design_review";
  operationalActionsEnabled: false;
  tasks: readonly FrozenTask[];
  runsPerTaskPerWorkflow: 2;
  plannedRunCount: 24;
  workflowConfigurations: readonly WorkflowConfiguration[];
  reviewDimensions: typeof REVIEW_DIMENSIONS;
  automaticMetrics: typeof AUTOMATIC_METRICS;
  adoptionRequirements: typeof PROVISIONAL_ADOPTION_REQUIREMENTS;
  rollbackConditions: typeof PROVISIONAL_ROLLBACK_CONDITIONS;
  thresholdsStatus: "provisional_awaiting_design_review";
  unresolvedDecisions: ReadonlyArray<{
    id: string;
    question: (typeof UNRESOLVED_DECISIONS)[number];
    status: "undecided";
  }>;
}

export const FROZEN_TASKS: readonly FrozenTask[] = [
  {
    id: "T01",
    title: "Compare two vendors against fixed operational requirements",
    category: "comparison",
    prompt: "Using only packet TP-T01-v1, compare Vendor North and Vendor South against every fixed operational requirement. Cite each material claim, identify unmet requirements, and recommend one vendor or no selection with calibrated uncertainty.",
    inputPacketId: "TP-T01-v1",
    inputDescription: "Two frozen vendor fact sheets, pricing schedules, support terms, and eight operational requirements.",
    evidenceObligations: ["Every requirement maps to both vendors", "Every material comparison cites packet evidence", "Missing evidence remains explicit"],
    rationale: "Vendor selection is a common bounded comparison requiring factual matching, trade-offs, and an actionable recommendation.",
    frozen: true,
  },
  {
    id: "T02",
    title: "Compare two policy options using conflicting evidence",
    category: "comparison",
    additionalCoverage: "evidence_synthesis",
    prompt: "Using only packet TP-T02-v1, compare Policy A and Policy B. Reconcile the conflicting findings, distinguish fact from value judgement, cite material claims, and recommend an option with explicit trade-offs and uncertainty.",
    inputPacketId: "TP-T02-v1",
    inputDescription: "Two policy briefs, three studies with conflicting findings, and a frozen stakeholder-priority statement.",
    evidenceObligations: ["Conflicts are represented rather than averaged away", "Trade-offs cite supporting evidence", "Value judgements are labelled"],
    rationale: "Policy choice tests comparison when evidence conflicts and the answer depends on transparent trade-offs rather than feature matching.",
    frozen: true,
  },
  {
    id: "T03",
    title: "Discover tools under fixed constraints",
    category: "discovery",
    prompt: "Using only packet TP-T03-v1, identify tools satisfying the fixed budget, platform, and capability constraints. Show inclusion and exclusion evidence, cite every candidate claim, and state unresolved gaps.",
    inputPacketId: "TP-T03-v1",
    inputDescription: "A frozen candidate catalogue, pricing snapshots, platform support, capability evidence, and constraint checklist.",
    evidenceObligations: ["All hard constraints are tested", "Included and excluded candidates are traceable", "Unknowns do not become passes"],
    rationale: "Constrained tool discovery represents practical research where completeness and honest exclusion logic matter as much as the shortlist.",
    frozen: true,
  },
  {
    id: "T04",
    title: "Discover authoritative sources and evidence gaps",
    category: "discovery",
    additionalCoverage: "evidence_synthesis",
    prompt: "Using only packet TP-T04-v1, identify the most authoritative sources relevant to the specified claim, map what each source supports, and list evidence gaps that prevent a stronger conclusion.",
    inputPacketId: "TP-T04-v1",
    inputDescription: "A frozen claim, mixed-quality source index, source metadata, and excerpts sufficient for authority and coverage assessment.",
    evidenceObligations: ["Authority judgements are explained", "Claim coverage links to sources", "Evidence gaps are explicit"],
    rationale: "Source discovery isolates AVA's ability to find the best available evidence and admit where that evidence cannot answer the question.",
    frozen: true,
  },
  {
    id: "T05",
    title: "Assess a vendor security and privacy packet",
    category: "due_diligence",
    prompt: "Using only packet TP-T05-v1, assess the vendor security and privacy materials for risks, control gaps, contradictions, and unsupported assertions. Cite every material finding and separate verified controls from vendor claims.",
    inputPacketId: "TP-T05-v1",
    inputDescription: "A frozen security questionnaire, audit summary, privacy terms, architecture note, and vendor assertions.",
    evidenceObligations: ["Risks link to exact packet evidence", "Assertions are not treated as verified controls", "Critical unsupported claims are flagged"],
    rationale: "Due diligence tests high-consequence scrutiny, provenance, unsupported-claim detection, and conservative uncertainty.",
    frozen: true,
  },
  {
    id: "T06",
    title: "Synthesize conflicting sources into a recommendation",
    category: "evidence_synthesis",
    prompt: "Using only packet TP-T06-v1, synthesize the conflicting sources into a cited recommendation. Explain disagreement, weigh source quality, identify material uncertainty, and state what evidence could change the recommendation.",
    inputPacketId: "TP-T06-v1",
    inputDescription: "A frozen question, two primary sources, two secondary analyses, one dissenting source, and source-quality metadata.",
    evidenceObligations: ["Disagreement remains visible", "Recommendation cites material support", "Uncertainty and decision-changing evidence are stated"],
    rationale: "Evidence synthesis represents AVA's core research task: turning disagreement into a useful recommendation without overstating certainty.",
    frozen: true,
  },
] as const;

const SHARED_SETTINGS = { temperature: 0, maxOutputTokens: 2400, seedPolicy: "fixed-per-replicate" } as const;

export const EXPERIMENT_SPECIFICATION: ExperimentSpecification = {
  phase: "design_review",
  operationalActionsEnabled: false,
  tasks: FROZEN_TASKS,
  runsPerTaskPerWorkflow: 2,
  plannedRunCount: 24,
  workflowConfigurations: [
    { version: "baseline", model: "frozen-model-placeholder", settings: SHARED_SETTINGS, rubricVersion: "TP-RUBRIC-v1", controlledChange: "none" },
    { version: "revised", model: "frozen-model-placeholder", settings: SHARED_SETTINGS, rubricVersion: "TP-RUBRIC-v1", controlledChange: "pending-separate-approval" },
  ],
  reviewDimensions: REVIEW_DIMENSIONS,
  automaticMetrics: AUTOMATIC_METRICS,
  adoptionRequirements: PROVISIONAL_ADOPTION_REQUIREMENTS,
  rollbackConditions: PROVISIONAL_ROLLBACK_CONDITIONS,
  thresholdsStatus: "provisional_awaiting_design_review",
  unresolvedDecisions: UNRESOLVED_DECISIONS.map((question, index) => ({ id: `D${index + 1}`, question, status: "undecided" as const })),
};

export function plannedRunIds(specification: ExperimentSpecification = EXPERIMENT_SPECIFICATION): string[] {
  return specification.workflowConfigurations.flatMap(({ version }) =>
    specification.tasks.flatMap(({ id }) =>
      ([1, 2] as const).map((replicate) => `${version === "baseline" ? "B" : "R"}-${id}-${replicate}`),
    ),
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateExperimentDesign(
  specification: ExperimentSpecification,
  records: readonly ExperimentRunRecord[],
): void {
  invariant(specification.phase === "design_review" && !specification.operationalActionsEnabled, "pilot must remain design-only");
  invariant(specification.tasks.length === 6, "experiment must contain exactly six tasks");
  invariant(new Set(specification.tasks.map((task) => task.id)).size === 6, "task IDs must be unique");
  invariant(specification.tasks.every((task) => task.frozen && task.rationale.trim() && task.prompt.trim()), "every task must be frozen with a prompt and rationale");
  const coverage = new Set<string>(specification.tasks.flatMap((task) => [task.category, task.additionalCoverage].filter(Boolean) as string[]));
  for (const required of ["comparison", "discovery", "due_diligence", "evidence_synthesis"]) {
    invariant(coverage.has(required), `missing task coverage: ${required}`);
  }
  invariant(specification.runsPerTaskPerWorkflow === 2, "exactly two runs are required per task and workflow");
  invariant(specification.plannedRunCount === 24, "planned run count must be exactly 24");
  invariant(records.length === 24, "record matrix must contain exactly 24 synthetic runs");
  invariant(new Set(records.map((record) => record.runId)).size === 24, "run IDs must be unique");
  invariant(
    JSON.stringify(specification.workflowConfigurations[0]?.settings) === JSON.stringify(specification.workflowConfigurations[1]?.settings) &&
      specification.workflowConfigurations[0]?.model === specification.workflowConfigurations[1]?.model &&
      specification.workflowConfigurations[0]?.rubricVersion === specification.workflowConfigurations[1]?.rubricVersion,
    "paired workflows must use identical model, settings, and rubric",
  );
  const expectedIds = plannedRunIds(specification);
  invariant(expectedIds.every((id) => records.some((record) => record.runId === id)), "run matrix is incomplete");

  const taskById = new Map(specification.tasks.map((task) => [task.id, task]));
  for (const record of records) {
    const task = taskById.get(record.taskId);
    invariant(task, `unknown task ${record.taskId}`);
    invariant(record.synthetic && record.syntheticNotice === SYNTHETIC_DATA_NOTICE, `${record.runId} is not explicitly synthetic`);
    invariant(record.prompt === task.prompt, `${record.runId} changed the frozen prompt`);
    invariant(record.inputs.some((input) => input.id === task.inputPacketId), `${record.runId} changed the frozen input packet`);
    invariant(record.configuration.model === specification.workflowConfigurations[0]?.model, `${record.runId} changed the model`);
    invariant(record.configuration.rubricVersion === specification.workflowConfigurations[0]?.rubricVersion, `${record.runId} changed the rubric`);
    invariant(REVIEW_DIMENSIONS.every((dimension) => record.review.ratings[dimension] >= 1 && record.review.ratings[dimension] <= 5), `${record.runId} is missing a 1–5 review rating`);
    invariant(AUTOMATIC_METRICS.every((metric) => record.metrics[metric]?.derivation && record.metrics[metric]?.sourceRecordIds.length), `${record.runId} is missing metric provenance`);
    invariant(record.agents.length > 0 && record.toolActivity.length > 0 && record.sources.length > 0 && record.decisions.length > 0, `${record.runId} is missing audit activity`);
    invariant(record.approvals.some((approval) => approval.boundary === "design_mock" && approval.status === "approved_for_mock"), `${record.runId} lacks design approval provenance`);
    invariant(record.approvals.filter((approval) => approval.boundary !== "design_mock").every((approval) => approval.status !== "approved_for_mock"), `${record.runId} crosses an operational approval boundary`);
    invariant(record.timings.latencyMs === Date.parse(record.timings.endedAt) - Date.parse(record.timings.startedAt), `${record.runId} timing derivation is inconsistent`);
    invariant(metricNumber(record, "tokenUsage") === record.usage.inputTokens + record.usage.outputTokens, `${record.runId} token derivation is inconsistent`);

    const sourceIds = new Set(record.sources.map((source) => source.id));
    invariant(record.claims.every((claim) => claim.sourceIds.every((id) => sourceIds.has(id))), `${record.runId} has a broken claim/source link`);
    invariant(record.decisions.every((decision) => decision.sourceIds.every((id) => sourceIds.has(id))), `${record.runId} has a broken decision/source link`);
    invariant(record.output.citationIds.every((id) => sourceIds.has(id)), `${record.runId} has a broken output citation`);
    const errorIds = new Set(record.errors.map((error) => error.id));
    invariant(record.toolActivity.every((activity) => !activity.errorId || errorIds.has(activity.errorId)), `${record.runId} has a broken tool/error link`);
    const provenanceIds = new Set([
      record.runId,
      ...record.toolActivity.map((activity) => activity.id),
      ...record.claims.map((claim) => claim.id),
      ...record.errors.map((error) => error.id),
      ...record.sources.map((source) => source.id),
      record.timings.id,
      record.usage.id,
    ]);
    invariant(Object.values(record.metrics).every((metric) => metric.sourceRecordIds.every((id) => provenanceIds.has(id))), `${record.runId} has broken metric provenance`);
  }
}

export function qualityMean(record: ExperimentRunRecord, dimension: ReviewDimension): number {
  return record.review.ratings[dimension];
}

export function metricNumber(record: ExperimentRunRecord, metric: AutomaticMetricName): number {
  const value = record.metrics[metric].value;
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}
