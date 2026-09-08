import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writePlaybook, type Playbook } from "../playbooks/store.js";
import { buildLearnedWorkflowSnapshot } from "./workflows.js";

function playbook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    slug: "retrieve-context",
    trigger: "Retrieve stored user context",
    keywords: ["memory", "projects"],
    created: "2026-07-25",
    last_used: "2026-07-25",
    uses: 1,
    stakes: "routine",
    steps: ["Read durable memory", "Summarise the relevant records"],
    version: 1,
    succ: 0,
    fail: 0,
    avg_secs: 0,
    lessons: [],
    ...overrides,
  };
}

describe("learned workflow projection", () => {
  it("is dynamic and returns no example workflows when procedural memory is empty", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "ava-explorer-workflows-"));
    expect(buildLearnedWorkflowSnapshot(memoryDir, 100)).toMatchObject({
      workflows: [],
      summary: { total: 0 },
      source: { status: "available", parsedRecords: 0 },
    });

    // Distillation seeds avg_secs from the creating task before any recalled
    // outcome exists. Explorer must not mislabel that seed as recall evidence.
    writePlaybook(memoryDir, playbook({ avg_secs: 19 }));
    const learned = buildLearnedWorkflowSnapshot(memoryDir, 200);
    expect(learned.workflows).toHaveLength(1);
    expect(learned.workflows[0]).toMatchObject({
      id: "playbook:retrieve-context",
      evidenceState: "definition_only",
      provenance: {
        source: "procedural_memory_playbook",
        sourceId: "retrieve-context",
        creationMethod: "not_recorded",
      },
      metrics: {
        recalls: 1,
        evidenceOutcomes: 0,
        verificationRate: null,
        averageVerifiedDurationMs: null,
      },
    });
    expect(learned.generatedAt).toBe(200);
  });

  it("reports only parsed records and labels malformed files as excluded", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "ava-explorer-workflows-"));
    writePlaybook(memoryDir, playbook({
      succ: 3, fail: 1, avg_secs: 7.5,
      learning: {
        verified: 3, partially_verified: 0, unverified: 0, contradicted: 1,
        failed: 0, not_applicable: 0, last_task_id: "task-4",
        last_method: "fixture", last_evidence_at: 4, recent_task_ids: ["task-4"],
      },
    }));
    const directory = join(memoryDir, "playbooks");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "malformed.md"), "not a playbook", "utf8");

    const snapshot = buildLearnedWorkflowSnapshot(memoryDir, 300);
    expect(snapshot.source).toMatchObject({
      parsedRecords: 1,
      excludedUnparseableRecords: 1,
    });
    expect(snapshot.workflows[0]).toMatchObject({
      evidenceState: "verified_outcomes",
      metrics: {
        verifiedRuns: 3,
        contradictedRuns: 1,
        evidenceOutcomes: 4,
        verificationRate: 0.75,
        averageVerifiedDurationMs: 7_500,
        legacyReportedFinals: 3,
        legacyRuntimeFailures: 1,
      },
    });
    expect(snapshot.coverage).toMatchObject({
      capabilityLinksRecorded: false,
      taskLinksRecorded: false,
    });
  });
});
