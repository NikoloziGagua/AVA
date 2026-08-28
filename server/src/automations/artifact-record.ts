import { createHash } from "node:crypto";

export type AutomationArtifactRecord = {
  id: string;
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  title: string;
  summary: string;
  artifact_path: string;
  artifact_hash: string;
  verification_method: string;
  record_fingerprint: string;
  created_at: number;
};

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function automationArtifactFingerprint(
  record: Omit<AutomationArtifactRecord, "record_fingerprint">,
): string {
  return sha256(JSON.stringify({
    id: record.id,
    runId: record.run_id,
    workflowId: record.workflow_id,
    workflowVersion: record.workflow_version,
    title: record.title,
    summary: record.summary,
    artifactPath: record.artifact_path,
    artifactHash: record.artifact_hash,
    verificationMethod: record.verification_method,
    createdAt: record.created_at,
  }));
}
