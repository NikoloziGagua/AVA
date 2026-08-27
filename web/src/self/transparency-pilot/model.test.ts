import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_METRICS,
  EXPERIMENT_SPECIFICATION,
  PROVISIONAL_ADOPTION_REQUIREMENTS,
  PROVISIONAL_ROLLBACK_CONDITIONS,
  REVIEW_DIMENSIONS,
  SYNTHETIC_DATA_NOTICE,
  TASK_IDS,
  UNRESOLVED_DECISIONS,
  plannedRunIds,
  validateExperimentDesign,
  type ExperimentSpecification,
} from "./model.js";
import { SYNTHETIC_RUN_RECORDS } from "./mockRecords.js";

describe("transparency pilot experiment contract", () => {
  it("freezes exactly six unique representative tasks with complete category coverage and rationale", () => {
    const tasks = EXPERIMENT_SPECIFICATION.tasks;
    expect(tasks).toHaveLength(6);
    expect(tasks.map((task) => task.id)).toEqual(TASK_IDS);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(6);
    expect(tasks.every((task) => task.frozen && task.prompt && task.inputPacketId && task.evidenceObligations.length && task.rationale)).toBe(true);
    const coverage = new Set<string>(tasks.flatMap((task) => [task.category, task.additionalCoverage].filter(Boolean) as string[]));
    for (const category of ["comparison", "discovery", "due_diligence", "evidence_synthesis"]) expect(coverage.has(category)).toBe(true);
  });

  it("plans exactly two runs for every task and workflow, yielding exactly 24 unique records", () => {
    expect(EXPERIMENT_SPECIFICATION.runsPerTaskPerWorkflow).toBe(2);
    expect(EXPERIMENT_SPECIFICATION.plannedRunCount).toBe(24);
    expect(plannedRunIds()).toHaveLength(24);
    expect(SYNTHETIC_RUN_RECORDS).toHaveLength(24);
    expect(new Set(SYNTHETIC_RUN_RECORDS.map((record) => record.runId)).size).toBe(24);
    for (const taskId of TASK_IDS) {
      for (const workflowVersion of ["baseline", "revised"] as const) {
        expect(SYNTHETIC_RUN_RECORDS.filter((record) => record.taskId === taskId && record.workflowVersion === workflowVersion)).toHaveLength(2);
      }
    }
  });

  it("keeps paired prompts, inputs, model settings, and rubric identical outside the pending controlled change", () => {
    const baselineConfig = EXPERIMENT_SPECIFICATION.workflowConfigurations[0]!;
    const revisedConfig = EXPERIMENT_SPECIFICATION.workflowConfigurations[1]!;
    expect(baselineConfig.model).toBe(revisedConfig.model);
    expect(baselineConfig.settings).toEqual(revisedConfig.settings);
    expect(baselineConfig.rubricVersion).toBe(revisedConfig.rubricVersion);
    expect(revisedConfig.controlledChange).toBe("pending-separate-approval");
    for (const taskId of TASK_IDS) {
      const taskRecords = SYNTHETIC_RUN_RECORDS.filter((record) => record.taskId === taskId);
      expect(new Set(taskRecords.map((record) => record.prompt)).size).toBe(1);
      expect(new Set(taskRecords.map((record) => record.inputs[0]?.id)).size).toBe(1);
      expect(new Set(taskRecords.map((record) => JSON.stringify(record.configuration.settings))).size).toBe(1);
    }
  });

  it("requires five independent 1–5 review dimensions and every automatic metric with provenance", () => {
    expect(REVIEW_DIMENSIONS).toHaveLength(5);
    expect(AUTOMATIC_METRICS).toHaveLength(8);
    for (const record of SYNTHETIC_RUN_RECORDS) {
      expect(Object.keys(record.review.ratings).sort()).toEqual([...REVIEW_DIMENSIONS].sort());
      expect(Object.values(record.review.ratings).every((rating) => rating >= 1 && rating <= 5)).toBe(true);
      expect(Object.keys(record.metrics).sort()).toEqual([...AUTOMATIC_METRICS].sort());
      expect(Object.values(record.metrics).every((metric) => metric.source && metric.derivation && metric.sourceRecordIds.length > 0)).toBe(true);
    }
  });

  it("validates referential integrity, required audit fields, metric derivations, and synthetic labelling", () => {
    expect(() => validateExperimentDesign(EXPERIMENT_SPECIFICATION, SYNTHETIC_RUN_RECORDS)).not.toThrow();
    for (const record of SYNTHETIC_RUN_RECORDS) {
      expect(record.synthetic).toBe(true);
      expect(record.syntheticNotice).toBe(SYNTHETIC_DATA_NOTICE);
      expect(record.agents.length).toBeGreaterThan(0);
      expect(record.toolActivity.length).toBeGreaterThan(0);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.claims.length).toBeGreaterThan(0);
      expect(record.decisions.length).toBeGreaterThan(0);
      expect(record.output.uncertainty).toBeTruthy();
      expect(record.approvals).toHaveLength(4);
    }
    expect(SYNTHETIC_RUN_RECORDS.some((record) => record.errors.length > 0)).toBe(true);
    expect(SYNTHETIC_RUN_RECORDS.some((record) => record.toolActivity.some((activity) => activity.humanIntervention))).toBe(true);
    expect(SYNTHETIC_RUN_RECORDS.some((record) => record.claims.some((claim) => claim.critical && claim.support === "unsupported"))).toBe(true);
  });

  it("rejects an incomplete run matrix, configuration drift, and broken claim or metric provenance", () => {
    expect(() => validateExperimentDesign(EXPERIMENT_SPECIFICATION, SYNTHETIC_RUN_RECORDS.slice(1))).toThrow(/exactly 24/);

    const driftedSpec = structuredClone(EXPERIMENT_SPECIFICATION) as ExperimentSpecification;
    driftedSpec.workflowConfigurations[1]!.settings = {
      ...driftedSpec.workflowConfigurations[1]!.settings,
      temperature: 0.5,
    };
    expect(() => validateExperimentDesign(driftedSpec, SYNTHETIC_RUN_RECORDS)).toThrow(/identical model, settings, and rubric/);

    const brokenRecords = structuredClone(SYNTHETIC_RUN_RECORDS);
    brokenRecords[0]!.claims[0]!.sourceIds = ["missing-source"];
    expect(() => validateExperimentDesign(EXPERIMENT_SPECIFICATION, brokenRecords)).toThrow(/claim\/source link/);

    const brokenMetrics = structuredClone(SYNTHETIC_RUN_RECORDS);
    brokenMetrics[0]!.metrics.latencyMs.sourceRecordIds = ["missing-event"];
    expect(() => validateExperimentDesign(EXPERIMENT_SPECIFICATION, brokenMetrics)).toThrow(/metric provenance/);
  });

  it("keeps provisional requirements, rollback conditions, and all seven decisions explicit and non-operational", () => {
    expect(EXPERIMENT_SPECIFICATION.adoptionRequirements).toEqual(PROVISIONAL_ADOPTION_REQUIREMENTS);
    expect(EXPERIMENT_SPECIFICATION.rollbackConditions).toEqual(PROVISIONAL_ROLLBACK_CONDITIONS);
    expect(EXPERIMENT_SPECIFICATION.thresholdsStatus).toBe("provisional_awaiting_design_review");
    expect(EXPERIMENT_SPECIFICATION.operationalActionsEnabled).toBe(false);
    expect(EXPERIMENT_SPECIFICATION.unresolvedDecisions).toHaveLength(7);
    expect(EXPERIMENT_SPECIFICATION.unresolvedDecisions.map((decision) => decision.question)).toEqual(UNRESOLVED_DECISIONS);
    expect(EXPERIMENT_SPECIFICATION.unresolvedDecisions.every((decision) => decision.status === "undecided")).toBe(true);
    expect(SYNTHETIC_RUN_RECORDS.every((record) => record.approvals.filter((approval) => approval.boundary !== "design_mock").every((approval) => approval.status !== "approved_for_mock"))).toBe(true);
  });
});
