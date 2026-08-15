import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { listPlaybooks, type Playbook } from "../playbooks/store.js";
import { sanitiseExplorerText } from "./redaction.js";

export type ExplorerLearnedWorkflowStep = {
  id: string;
  sequence: number;
  label: string;
  source: "stored_playbook_step";
};

export type ExplorerLearnedWorkflow = {
  id: string;
  slug: string;
  trigger: string;
  keywords: string[];
  stakes: "routine" | "consequential";
  revision: number;
  created: string | null;
  lastUsed: string | null;
  steps: ExplorerLearnedWorkflowStep[];
  lessons: string[];
  metrics: {
    recalls: number;
    verifiedRuns: number;
    partiallyVerifiedRuns: number;
    unverifiedRuns: number;
    contradictedRuns: number;
    failedRuns: number;
    evidenceOutcomes: number;
    verificationRate: number | null;
    averageVerifiedDurationMs: number | null;
    legacyReportedFinals: number;
    legacyRuntimeFailures: number;
  };
  evidenceState: "verified_outcomes" | "legacy_reports" | "definition_only";
  provenance: {
    source: "procedural_memory_playbook";
    sourceId: string;
    storedDefinition: true;
    creationMethod: "not_recorded";
    metricsSource: "verified_learning_gate";
    note: string;
  };
  capabilityMapping: {
    status: "not_recorded";
    capabilityIds: [];
    reason: string;
  };
  taskLinkage: {
    status: "not_recorded";
    taskIds: [];
    reason: string;
  };
};

export type ExplorerLearnedWorkflowSnapshot = {
  workflows: ExplorerLearnedWorkflow[];
  summary: {
    total: number;
    withObservedOutcomes: number;
    definitionOnly: number;
    totalRecalls: number;
    verifiedRuns: number;
    partiallyVerifiedRuns: number;
    unverifiedRuns: number;
    contradictedRuns: number;
    failedRuns: number;
    legacyReportedFinals: number;
    legacyRuntimeFailures: number;
  };
  source: {
    id: "procedural_memory_playbooks";
    type: "local_playbook_store";
    status: "available";
    parsedRecords: number;
    excludedUnparseableRecords: number;
    readAt: number;
    note: string;
  };
  coverage: {
    capabilityLinksRecorded: false;
    taskLinksRecorded: false;
    note: string;
  };
  generatedAt: number;
};

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function successfulDurationMs(
  seconds: number,
  verifiedRuns: number,
): number | null {
  // New playbooks seed avg_secs from the task that created the procedure while
  // succ remains zero. Explorer must not call that seed an observed recalled-
  // run average until at least one recalled run has actually succeeded.
  if (
    verifiedRuns < 1 ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }
  return Math.round(seconds * 1_000);
}

function safeText(value: string): string {
  return sanitiseExplorerText(value) ?? "";
}

function safeStringList(values: string[]): string[] {
  return values.map(safeText);
}

function projectPlaybook(playbook: Playbook): ExplorerLearnedWorkflow {
  const recalls = nonNegativeInteger(playbook.uses);
  const learning = playbook.learning;
  const verifiedRuns = nonNegativeInteger(learning?.verified ?? 0);
  const partiallyVerifiedRuns = nonNegativeInteger(learning?.partially_verified ?? 0);
  const unverifiedRuns = nonNegativeInteger(learning?.unverified ?? 0);
  const contradictedRuns = nonNegativeInteger(learning?.contradicted ?? 0);
  const failedRuns = nonNegativeInteger(learning?.failed ?? 0);
  const evidenceOutcomes = verifiedRuns + partiallyVerifiedRuns + unverifiedRuns +
    contradictedRuns + failedRuns + nonNegativeInteger(learning?.not_applicable ?? 0);
  const verificationRate = evidenceOutcomes > 0
    ? Math.round((verifiedRuns / evidenceOutcomes) * 1_000) / 1_000
    : null;
  const slug = safeText(playbook.slug);
  const steps = safeStringList(playbook.steps).map((label, index) => ({
      id: `playbook:${slug}:step:${index + 1}`,
      sequence: index + 1,
      label,
      source: "stored_playbook_step" as const,
    }));

  return {
    id: `playbook:${slug}`,
    slug,
    trigger: safeText(playbook.trigger),
    keywords: safeStringList(playbook.keywords),
    stakes: playbook.stakes,
    revision: Math.max(1, nonNegativeInteger(playbook.version)),
    created: safeText(playbook.created) || null,
    lastUsed: safeText(playbook.last_used) || null,
    steps,
    lessons: safeStringList(playbook.lessons),
    metrics: {
      recalls,
      verifiedRuns,
      partiallyVerifiedRuns,
      unverifiedRuns,
      contradictedRuns,
      failedRuns,
      evidenceOutcomes,
      verificationRate,
      averageVerifiedDurationMs: successfulDurationMs(
        playbook.avg_secs,
        verifiedRuns,
      ),
      legacyReportedFinals: nonNegativeInteger(playbook.succ),
      legacyRuntimeFailures: nonNegativeInteger(playbook.fail),
    },
    evidenceState: evidenceOutcomes > 0
      ? "verified_outcomes"
      : playbook.succ + playbook.fail > 0 ? "legacy_reports" : "definition_only",
    provenance: {
      source: "procedural_memory_playbook",
      sourceId: slug,
      storedDefinition: true,
      // The current file schema does not retain whether a particular record
      // came from automatic capture, a merge, or an explicit store write.
      creationMethod: "not_recorded",
      metricsSource: "verified_learning_gate",
      note:
        "Learning outcomes come from terminal task receipts. Legacy final-response counters are retained separately and are not treated as proof.",
    },
    capabilityMapping: {
      status: "not_recorded",
      capabilityIds: [],
      reason:
        "The current playbook schema stores procedure text but not canonical Explorer capability IDs.",
    },
    taskLinkage: {
      status: "not_recorded",
      taskIds: [],
      reason:
        "The current task schema does not persist which playbook, if any, steered a run.",
    },
  };
}

/**
 * Build Explorer's learned-workflow view entirely from AVA's real procedural
 * memory. No example/demo workflows are inserted when the store is empty.
 */
export function buildLearnedWorkflowSnapshot(
  memoryDir: string,
  now = Date.now(),
): ExplorerLearnedWorkflowSnapshot {
  const directory = join(memoryDir, "playbooks");
  const fileCount = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith(".md")).length
    : 0;
  const workflows = listPlaybooks(memoryDir)
    .map(projectPlaybook)
    .sort((a, b) =>
      b.metrics.recalls - a.metrics.recalls ||
      (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") ||
      a.slug.localeCompare(b.slug));
  const sumMetric = (key: keyof ExplorerLearnedWorkflow["metrics"]) => workflows.reduce(
    (sum, workflow) => sum + Number(workflow.metrics[key] ?? 0), 0,
  );

  return {
    workflows,
    summary: {
      total: workflows.length,
      withObservedOutcomes: workflows.filter(
        (workflow) => workflow.evidenceState === "verified_outcomes",
      ).length,
      definitionOnly: workflows.filter(
        (workflow) => workflow.evidenceState === "definition_only",
      ).length,
      totalRecalls: workflows.reduce(
        (sum, workflow) => sum + workflow.metrics.recalls,
        0,
      ),
      verifiedRuns: sumMetric("verifiedRuns"),
      partiallyVerifiedRuns: sumMetric("partiallyVerifiedRuns"),
      unverifiedRuns: sumMetric("unverifiedRuns"),
      contradictedRuns: sumMetric("contradictedRuns"),
      failedRuns: sumMetric("failedRuns"),
      legacyReportedFinals: sumMetric("legacyReportedFinals"),
      legacyRuntimeFailures: sumMetric("legacyRuntimeFailures"),
    },
    source: {
      id: "procedural_memory_playbooks",
      type: "local_playbook_store",
      status: "available",
      parsedRecords: workflows.length,
      excludedUnparseableRecords: Math.max(0, fileCount - workflows.length),
      readAt: now,
      note:
        "Every returned workflow is a currently parseable record in AVA's local playbook store.",
    },
    coverage: {
      capabilityLinksRecorded: false,
      taskLinksRecorded: false,
      note:
        "Workflow definitions and recall metrics are real. Capability and task links remain unavailable " +
        "until those identifiers are persisted by the capture and task runtimes.",
    },
    generatedAt: now,
  };
}
