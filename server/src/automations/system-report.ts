import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { scrubSecrets } from "../security/scrub.js";
import type { ObservabilityService } from "../observability/store.js";
import { automationArtifactFingerprint, sha256, type AutomationArtifactRecord } from "./artifact-record.js";
import { AutomationExecutorError } from "./activepieces.js";
import { SYSTEM_REPORT_WORKFLOW, type AutomationExecutor, type AutomationRun, type AutomationSystemSnapshot } from "./types.js";

type RunRow = {
  id: string; request_key: string; workflow_id: string; workflow_version: number; executor: string;
  external_run_id: string | null; observability_run_id: string; status: AutomationRun["status"];
  version: number; step_count: number; input_summary: string; output_summary: string;
  artifact_path: string | null; artifact_hash: string | null; memory_entry_id: string | null;
  verification_state: AutomationRun["verificationState"]; verification_method: string | null;
  error_code: string | null; error_message: string | null; created_at: number; updated_at: number; completed_at: number | null;
};

function safeJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function mapRun(row: RunRow): AutomationRun {
  return { id: row.id, requestKey: row.request_key, workflowId: row.workflow_id,
    workflowVersion: row.workflow_version, executor: row.executor, externalRunId: row.external_run_id,
    observabilityRunId: row.observability_run_id, status: row.status, version: row.version,
    stepCount: row.step_count, inputSummary: safeJson(row.input_summary), outputSummary: safeJson(row.output_summary),
    artifactPath: row.artifact_path, artifactHash: row.artifact_hash, memoryEntryId: row.memory_entry_id,
    verificationState: row.verification_state, verificationMethod: row.verification_method,
    errorCode: row.error_code, errorMessage: row.error_message ? scrubSecrets(row.error_message) : null,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at };
}

export class SystemReportAutomationService {
  private readonly artifactDir: string;
  constructor(private readonly db: Db, private readonly executor: AutomationExecutor,
    dataDir: string, private readonly snapshot: () => Promise<AutomationSystemSnapshot>,
    private readonly observability: ObservabilityService | null = null,
    private readonly indexArtifact: ((recordId: string) => Promise<string | null>) | null = null) {
    this.artifactDir = join(dataDir, "automation-artifacts");
    const now = Date.now();
    db.prepare(`UPDATE automation_runs SET status='failed', verification_state='unavailable',
      error_code='interrupted_by_restart', error_message='AVA restarted before the workflow returned.',
      completed_at=?, updated_at=?, version=version+1 WHERE status IN ('queued','running')`).run(now, now);
  }

  health() { return this.executor.health(); }
  get(id: string): AutomationRun | null {
    const row = this.db.prepare("SELECT * FROM automation_runs WHERE id=?").get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }
  list(limit = 20): AutomationRun[] {
    return (this.db.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(100, limit))) as RunRow[]).map(mapRun);
  }

  async run(input: { requestKey: string; parentRunId?: string | null; signal?: AbortSignal }): Promise<AutomationRun> {
    const requestKey = scrubSecrets(input.requestKey).trim().slice(0, 180);
    if (!requestKey) throw new Error("automation request key is required");
    const prior = this.db.prepare("SELECT * FROM automation_runs WHERE request_key=?").get(requestKey) as RunRow | undefined;
    if (prior) return mapRun(prior);
    const health = this.executor.health();
    const now = Date.now();
    const id = `automation_${nanoid(18)}`;
    const obsId = `automation-run-${id}`;
    const systemSnapshot = await this.snapshot();
    const inputSummary = { workflow: SYSTEM_REPORT_WORKFLOW.id, generatedAt: systemSnapshot.generatedAt,
      ready: systemSnapshot.ready, counts: systemSnapshot.counts };
    this.db.prepare(`INSERT INTO automation_runs (id,request_key,input_fingerprint,workflow_id,workflow_version,
      executor,observability_run_id,status,version,input_summary,output_summary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?, ?,1,?,'{}',?,?)`).run(id, requestKey, sha256(JSON.stringify(systemSnapshot)),
        SYSTEM_REPORT_WORKFLOW.id, SYSTEM_REPORT_WORKFLOW.version, this.executor.id, obsId,
        health.available ? "queued" : "unavailable", JSON.stringify(inputSummary), now, now);
    if (!health.available) {
      this.db.prepare(`UPDATE automation_runs SET error_code='executor_unavailable',error_message=?,
        verification_state='unavailable',completed_at=?,version=version+1 WHERE id=?`).run(health.reason, now, id);
      return this.get(id)!;
    }
    const parent = input.parentRunId ? this.observability?.getRun(input.parentRunId) : null;
    if (this.observability) {
      this.observability.startRun({ id: obsId, traceId: parent?.traceId, parentRunId: parent?.id ?? null,
        rootTaskId: parent?.rootTaskId ?? parent?.id ?? null, sessionId: parent?.sessionId ?? null,
        runKind: "automation_workflow", runtimeType: "external_adapter", ownerType: "ava",
        ownerId: "automation-router", ownerRole: "orchestration", title: "AVA system health report",
        objective: "Run the pinned Activepieces playbook and independently verify its artifact.", privacyLevel: "normal" });
      this.observability.record(obsId, { eventId: `${id}:delegated`, type: "automation.delegated", status: "queued",
        title: "Pinned workflow delegated", summary: "AVA sent a bounded readiness snapshot to the configured executor.",
        actionId: id, actionOwner: "router", payload: { workflowId: SYSTEM_REPORT_WORKFLOW.id,
          workflowVersion: SYSTEM_REPORT_WORKFLOW.version, usage: "not_reported", cost: "not_reported" } });
    }
    this.db.prepare("UPDATE automation_runs SET status='running',version=version+1,updated_at=? WHERE id=?").run(Date.now(), id);
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) abort(); else input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await this.executor.execute({ requestKey, workflowId: SYSTEM_REPORT_WORKFLOW.id,
        workflowVersion: SYSTEM_REPORT_WORKFLOW.version, snapshot: systemSnapshot, signal: controller.signal });
      if (result.status !== "succeeded" || !result.report) {
        const completedAt = Date.now();
        this.db.prepare(`UPDATE automation_runs SET status='failed', external_run_id=?,step_count=?,output_summary=?,
          error_code=?,error_message=?,verification_state='unavailable',completed_at=?,updated_at=?,version=version+1 WHERE id=?`)
          .run(result.externalRunId, result.steps.length, JSON.stringify({ steps: result.steps }), result.error?.code ?? "workflow_failed",
            result.error?.message ?? "Workflow failed", completedAt, completedAt, id);
        this.recordTerminal(obsId, id, "failed", result.error?.message ?? "Workflow failed", result.externalRunId);
        return this.get(id)!;
      }
      await mkdir(this.artifactDir, { recursive: true });
      const markdown = scrubSecrets(result.report.markdown).trim();
      const hash = sha256(markdown);
      const finalPath = join(this.artifactDir, `${id}.md`);
      const tempPath = `${finalPath}.tmp`;
      await writeFile(tempPath, markdown, { encoding: "utf8", flag: "wx" });
      await rename(tempPath, finalPath);
      const readback = await readFile(finalPath, "utf8");
      if (sha256(readback) !== hash) throw new AutomationExecutorError("artifact_verification_failed", "AVA read-back did not match the workflow artifact");
      const createdAt = Date.now();
      const recordBase: Omit<AutomationArtifactRecord, "record_fingerprint"> = { id: `artifact_${id}`, run_id: id,
        workflow_id: SYSTEM_REPORT_WORKFLOW.id, workflow_version: SYSTEM_REPORT_WORKFLOW.version,
        title: scrubSecrets(result.report.title).slice(0, 160), summary: "Verified AVA system health report generated by the pinned automation workflow.",
        artifact_path: finalPath, artifact_hash: hash, verification_method: "filesystem_readback_sha256", created_at: createdAt };
      const record = { ...recordBase, record_fingerprint: automationArtifactFingerprint(recordBase) };
      this.db.prepare(`INSERT INTO automation_artifact_records (id,run_id,workflow_id,workflow_version,title,summary,
        artifact_path,artifact_hash,verification_method,record_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(record.id, record.run_id, record.workflow_id, record.workflow_version, record.title, record.summary,
          record.artifact_path, record.artifact_hash, record.verification_method, record.record_fingerprint, record.created_at);
      const memoryEntryId = this.indexArtifact ? await this.indexArtifact(record.id) : null;
      this.db.prepare(`UPDATE automation_runs SET status='completed',external_run_id=?,step_count=?,output_summary=?,
        artifact_path=?,artifact_hash=?,memory_entry_id=?,verification_state='verified',verification_method='filesystem_readback_sha256',
        completed_at=?,updated_at=?,version=version+1 WHERE id=? AND status='running'`).run(result.externalRunId,
          result.steps.length, JSON.stringify({ title: record.title, steps: result.steps, usage: result.usage, cost: result.cost }),
          finalPath, hash, memoryEntryId, createdAt, createdAt, id);
      this.recordTerminal(obsId, id, "completed", "AVA independently read back and hash-verified the generated report.", result.externalRunId);
      return this.get(id)!;
    } catch (error) {
      const completedAt = Date.now();
      const code = error instanceof AutomationExecutorError ? error.code : "automation_failed";
      const status = code === "cancelled" ? "cancelled" : code.includes("timeout") ? "timed_out" : "failed";
      const message = scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 500);
      this.db.prepare(`UPDATE automation_runs SET status=?,error_code=?,error_message=?,verification_state='unavailable',
        completed_at=?,updated_at=?,version=version+1 WHERE id=? AND status='running'`).run(status, code, message, completedAt, completedAt, id);
      this.recordTerminal(obsId, id, status, message, null);
      return this.get(id)!;
    } finally { input.signal?.removeEventListener("abort", abort); }
  }

  private recordTerminal(runId: string, actionId: string, status: string, summary: string, providerRequestId: string | null) {
    this.observability?.record(runId, { eventId: `${actionId}:terminal`, type: "automation.completed",
      status, title: status === "completed" ? "Automation verified" : "Automation ended",
      summary, actionId, actionOwner: "executor", providerRequestId, terminal: true,
      runStatus: status === "completed" ? "completed" : status === "cancelled" ? "cancelled"
        : status === "timed_out" ? "timed_out" : "failed",
      outcome: status === "completed" ? "verified_artifact" : status,
      verificationStatus: status === "completed" ? "verified" : "not_verified",
      compactSummary: summary,
      payload: { verification: status === "completed" ? "verified" : "unavailable", usage: "not_reported", cost: "not_reported" } });
  }
}
