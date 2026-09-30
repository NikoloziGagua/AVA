import {
  EXPERIMENT_SPECIFICATION,
  SYNTHETIC_DATA_NOTICE,
  type ExperimentRunRecord,
  type FrozenTask,
  type ReviewDimension,
  type WorkflowVersion,
} from "./model.js";

const BASE_TIME = Date.parse("2026-08-20T09:00:00.000Z");

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function score(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, value)) as 1 | 2 | 3 | 4 | 5;
}

function makeRecord(
  task: FrozenTask,
  workflowVersion: WorkflowVersion,
  replicate: 1 | 2,
  taskIndex: number,
): ExperimentRunRecord {
  const prefix = workflowVersion === "baseline" ? "B" : "R";
  const runId = `${prefix}-${task.id}-${replicate}`;
  const start = BASE_TIME + (workflowVersion === "revised" ? 12 : 0) * 60 * 60 * 1000 + taskIndex * 32 * 60 * 1000 + replicate * 4 * 60 * 1000;
  const latencyMs = 84_000 + taskIndex * 7_200 + replicate * 3_400 - (workflowVersion === "revised" ? 11_000 : 0);
  const end = start + latencyMs;
  const sourceA = `${runId}-S1`;
  const sourceB = `${runId}-S2`;
  const toolA = `${runId}-E1`;
  const toolB = `${runId}-E2`;
  const toolC = `${runId}-E3`;
  const errorId = `${runId}-ERR1`;
  const claimA = `${runId}-C1`;
  const claimB = `${runId}-C2`;
  const claimC = `${runId}-C3`;
  const humanIntervention = (workflowVersion === "baseline" && taskIndex === 4 && replicate === 2) ||
    (workflowVersion === "revised" && taskIndex === 1 && replicate === 1);
  const hasFailure = workflowVersion === "baseline" && taskIndex === 3 && replicate === 2;
  const criticalUnsupported = workflowVersion === "revised" && taskIndex === 4 && replicate === 2;
  const unsupportedCount = criticalUnsupported ? 1 : (workflowVersion === "baseline" && (taskIndex + replicate) % 4 === 0 ? 1 : 0);
  const completed = !hasFailure;
  const baseQuality = 3 + ((taskIndex + replicate) % 2);
  const revisedLift = workflowVersion === "revised" && taskIndex % 3 === 0 ? 1 : 0;
  const ratings = Object.fromEntries(
    (["correctness", "evidenceSupport", "completeness", "uncertaintyCalibration", "practicalUsefulness"] as ReviewDimension[])
      .map((dimension, dimensionIndex) => [dimension, score(baseQuality + revisedLift - (dimensionIndex === 2 && hasFailure ? 1 : 0) - (criticalUnsupported && dimensionIndex < 2 ? 1 : 0))]),
  ) as Record<ReviewDimension, 1 | 2 | 3 | 4 | 5>;
  const config = EXPERIMENT_SPECIFICATION.workflowConfigurations.find((candidate) => candidate.version === workflowVersion)!;
  const errorRecords = hasFailure || humanIntervention
    ? [{
      id: errorId,
      stage: hasFailure ? "source assessment" : "constraint interpretation",
      message: hasFailure ? "Synthetic source parser failure remained unresolved." : "Synthetic ambiguity required a reviewer clarification.",
      severity: hasFailure ? "failure" as const : "warning" as const,
      recovered: !hasFailure,
      humanIntervention,
    }]
    : [];
  const toolActivity = [
    {
      id: toolA,
      sequence: 1,
      tool: "packet_index",
      purpose: "Index the frozen input packet",
      status: "completed" as const,
      startedAt: iso(start + 2_000),
      endedAt: iso(start + 12_000),
      humanIntervention: false,
    },
    {
      id: toolB,
      sequence: 2,
      tool: workflowVersion === "baseline" ? "evidence_reader" : "evidence_reader_candidate",
      purpose: workflowVersion === "baseline"
        ? "Extract cited evidence using the synthetic baseline path"
        : "Exercise the synthetic revised-workflow placeholder",
      status: hasFailure ? "failed" as const : "completed" as const,
      startedAt: iso(start + 14_000),
      endedAt: iso(start + 42_000),
      humanIntervention,
      ...(hasFailure || humanIntervention ? { errorId } : {}),
    },
    {
      id: toolC,
      sequence: 3,
      tool: "claim_source_audit",
      purpose: "Audit material claim and source links",
      status: hasFailure ? "blocked" as const : "completed" as const,
      startedAt: iso(start + 44_000),
      endedAt: iso(Math.min(end, start + 70_000)),
      humanIntervention: false,
      ...(hasFailure ? { errorId } : {}),
    },
  ];
  const claims = [
    { id: claimA, text: `Synthetic finding one for ${task.id}.`, material: true, critical: false, sourceIds: [sourceA], support: "supported" as const },
    { id: claimB, text: `Synthetic trade-off for ${task.id}.`, material: true, critical: false, sourceIds: [sourceA, sourceB], support: "supported" as const },
    {
      id: claimC,
      text: criticalUnsupported ? "Synthetic critical assertion intentionally lacks support." : `Synthetic uncertainty for ${task.id}.`,
      material: true,
      critical: criticalUnsupported,
      sourceIds: unsupportedCount ? [] : [sourceB],
      support: unsupportedCount ? "unsupported" as const : "partial" as const,
    },
  ];
  const citationCoverage = claims.filter((claim) => claim.sourceIds.length > 0).length / claims.length;
  const tokenUsage = 3_900 + taskIndex * 180 + replicate * 90 - (workflowVersion === "revised" ? 410 : 0);
  const outputTokens = 620 + taskIndex * 22 + replicate * 17;

  return {
    schemaVersion: "transparency-pilot/1.0",
    synthetic: true,
    syntheticNotice: SYNTHETIC_DATA_NOTICE,
    runId,
    taskId: task.id,
    replicate,
    workflowVersion,
    prompt: task.prompt,
    inputs: [{ id: task.inputPacketId, label: task.inputDescription, digest: `sha256:synthetic-${task.id.toLowerCase()}-packet-v1` }],
    configuration: { ...config, settings: { ...config.settings } },
    agents: [{ id: `${runId}-A1`, role: "synthetic research worker", model: config.model, startedAt: iso(start), endedAt: iso(end) }],
    toolActivity,
    sources: [
      { id: sourceA, title: `${task.inputPacketId} primary exhibit`, locator: `packet://${task.inputPacketId}/primary`, authority: "provided_packet", retrievedAt: iso(start + 10_000) },
      { id: sourceB, title: `${task.inputPacketId} corroborating exhibit`, locator: `packet://${task.inputPacketId}/corroborating`, authority: "provided_packet", retrievedAt: iso(start + 25_000) },
    ],
    claims,
    decisions: [{
      id: `${runId}-D1`,
      sequence: 1,
      summary: completed ? "Produce a bounded synthetic recommendation." : "Stop the synthetic run after an unrecovered failure.",
      rationale: completed ? "The mock evidence obligations were represented sufficiently for UI design." : "The mock failure boundary prevents a false completion claim.",
      sourceIds: completed ? [sourceA, sourceB] : [sourceA],
      uncertainty: criticalUnsupported ? "Critical support is absent; a real run would be ineligible for adoption." : "This is synthetic design data and cannot establish real-world performance.",
    }],
    output: {
      summary: completed ? `Synthetic ${task.id} output with absolute metrics and cited variation.` : `Synthetic ${task.id} output stopped before completion.`,
      recommendation: completed ? "No operational decision — retain for mock-up review only." : "Investigate the synthetic failure; do not infer an outcome.",
      uncertainty: criticalUnsupported ? "High: one intentionally critical unsupported mock claim is visible." : "All values are synthetic; measured improvement is unknown.",
      citationIds: completed ? [sourceA, sourceB] : [sourceA],
    },
    errors: errorRecords,
    timings: { id: `${runId}-TIME1`, startedAt: iso(start), endedAt: iso(end), latencyMs },
    usage: { id: `${runId}-USE1`, inputTokens: tokenUsage - outputTokens, cachedInputTokens: 0, outputTokens, monetaryCost: null, currency: null },
    approvals: [
      { id: `${runId}-AP1`, boundary: "design_mock", status: "approved_for_mock", actor: "Self approval gate", recordedAt: "2026-08-27T19:58:00.000Z", note: "Authorized synthetic specification and read-only mock-up only." },
      { id: `${runId}-AP2`, boundary: "baseline", status: "not_authorized", actor: "none", recordedAt: "2026-08-27T19:58:00.000Z", note: "Baseline capture requires later approval." },
      { id: `${runId}-AP3`, boundary: "controlled_change", status: "not_requested", actor: "none", recordedAt: "2026-08-27T19:58:00.000Z", note: "Controlled workflow change remains undefined and requires separate approval." },
      { id: `${runId}-AP4`, boundary: "adoption", status: "not_requested", actor: "none", recordedAt: "2026-08-27T19:58:00.000Z", note: "Synthetic mock data cannot authorize adoption." },
    ],
    review: {
      reviewerAlias: `Reviewer-${(taskIndex + replicate) % 3 + 1}`,
      assignmentId: `BLIND-${String((taskIndex * 7 + replicate * 5 + (workflowVersion === "revised" ? 11 : 0)) % 24 + 1).padStart(2, "0")}`,
      blindedWorkflowLabel: `Variant-${workflowVersion === "baseline" ? "M" : "Q"}`,
      randomizedOrder: (taskIndex * 7 + replicate * 5 + (workflowVersion === "revised" ? 11 : 0)) % 24 + 1,
      ratings,
      notes: "Synthetic blinded-review rating used only to exercise the design.",
    },
    metrics: {
      completion: { name: "completion", value: completed, unit: "boolean", source: "run_record", derivation: "True only when the synthetic run reaches an output without an unrecovered failure.", sourceRecordIds: [runId, ...(hasFailure ? [errorId] : [])] },
      latencyMs: { name: "latencyMs", value: latencyMs, unit: "ms", source: "timing_events", derivation: "endedAt minus startedAt.", sourceRecordIds: [`${runId}-TIME1`] },
      tokenUsage: { name: "tokenUsage", value: tokenUsage, unit: "tokens", source: "usage_record", derivation: "Synthetic input tokens plus output tokens; cached input is retained separately and no monetary cost is invented.", sourceRecordIds: [`${runId}-USE1`] },
      toolCalls: { name: "toolCalls", value: toolActivity.length, unit: "count", source: "tool_activity", derivation: "Count of structured tool-activity records.", sourceRecordIds: toolActivity.map((activity) => activity.id) },
      humanInterventions: { name: "humanInterventions", value: humanIntervention ? 1 : 0, unit: "count", source: "tool_activity", derivation: "Count of tool activities flagged as human intervention.", sourceRecordIds: humanIntervention ? [toolB] : [runId] },
      errorsAndFailures: { name: "errorsAndFailures", value: errorRecords.length, unit: "count", source: "run_record", derivation: "Count of structured warning, failure, and critical error records.", sourceRecordIds: errorRecords.length ? errorRecords.map((error) => error.id) : [runId] },
      citationCoverage: { name: "citationCoverage", value: citationCoverage, unit: "ratio", source: "claim_source_links", derivation: "Material claims with at least one linked source divided by all material claims.", sourceRecordIds: claims.map((claim) => claim.id) },
      unsupportedMaterialClaims: { name: "unsupportedMaterialClaims", value: unsupportedCount, unit: "count", source: "claim_source_links", derivation: "Count of material claims whose support state is unsupported.", sourceRecordIds: claims.map((claim) => claim.id) },
    },
  };
}

export const SYNTHETIC_RUN_RECORDS: readonly ExperimentRunRecord[] = EXPERIMENT_SPECIFICATION.workflowConfigurations.flatMap(({ version }) =>
  EXPERIMENT_SPECIFICATION.tasks.flatMap((task, taskIndex) =>
    ([1, 2] as const).map((replicate) => makeRecord(task, version, replicate, taskIndex)),
  ),
);
