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
    successfulRecalledRuns: number;
    failedRecalledRuns: number;
    observedOutcomes: number;
    successRate: number | null;
    averageSuccessfulDurationMs: number | null;
  };
  evidenceState: "observed_outcomes" | "definition_only";
  provenance: {
    source: "procedural_memory_playbook";
    sourceId: string;
    storedDefinition: true;
    creationMethod: "not_recorded";
    metricsSource: "playbook_recall_counters";
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
    successfulRecalledRuns: number;
    failedRecalledRuns: number;
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
  successfulRecalledRuns: number,
): number | null {
  // New playbooks seed avg_secs from the task that created the procedure while
  // succ remains zero. Explorer must not call that seed an observed recalled-
  // run average until at least one recalled run has actually succeeded.
  if (
    successfulRecalledRuns < 1 ||
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
  const successfulRecalledRuns = nonNegativeInteger(playbook.succ);
  const failedRecalledRuns = nonNegativeInteger(playbook.fail);
  const observedOutcomes = successfulRecalledRuns + failedRecalledRuns;
  const successRate = observedOutcomes > 0
    ? Math.round((successfulRecalledRuns / observedOutcomes) * 1_000) / 1_000
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
      successfulRecalledRuns,
      failedRecalledRuns,
      observedOutcomes,
      successRate,
      averageSuccessfulDurationMs: successfulDurationMs(
        playbook.avg_secs,
        successfulRecalledRuns,
      ),
    },
    evidenceState: observedOutcomes > 0 ? "observed_outcomes" : "definition_only",
    provenance: {
      source: "procedural_memory_playbook",
      sourceId: slug,
      storedDefinition: true,
      // The current file schema does not retain whether a particular record
      // came from automatic capture, a merge, or an explicit store write.
      creationMethod: "not_recorded",
      metricsSource: "playbook_recall_counters",
      note:
        "Definition and counters were parsed directly from AVA's durable playbook store. " +
        "A counter records recalled-playbook outcomes, not independent task verification.",
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
  const successfulRecalledRuns = workflows.reduce(
    (sum, workflow) => sum + workflow.metrics.successfulRecalledRuns,
    0,
  );
  const failedRecalledRuns = workflows.reduce(
    (sum, workflow) => sum + workflow.metrics.failedRecalledRuns,
    0,
  );

  return {
    workflows,
    summary: {
      total: workflows.length,
      withObservedOutcomes: workflows.filter(
        (workflow) => workflow.evidenceState === "observed_outcomes",
      ).length,
      definitionOnly: workflows.filter(
        (workflow) => workflow.evidenceState === "definition_only",
      ).length,
      totalRecalls: workflows.reduce(
        (sum, workflow) => sum + workflow.metrics.recalls,
        0,
      ),
      successfulRecalledRuns,
      failedRecalledRuns,
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
