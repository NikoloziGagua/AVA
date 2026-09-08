import { scrubSecrets } from "../security/scrub.js";

/**
 * Structured post-action evidence emitted by a tool after its ordinary executor
 * result. This is deliberately separate from `ok`: returning without an error
 * proves only that the executor reported success.
 */
export type ToolVerificationState =
  | "verified"
  | "contradicted"
  | "unavailable"
  | "not_applicable";

export type ToolVerificationEvidence = {
  state: ToolVerificationState;
  /** `task_outcome` may close the user's requested outcome; `operation` proves
   * only the local tool step and therefore yields, at most, partial verification. */
  scope: "operation" | "task_outcome";
  /** Stable, machine-readable verifier identity (for example `fs_readback`). */
  method: string;
  /** Bounded operational explanation. Never place secrets or raw payloads here. */
  summary: string;
  /** Optional non-secret reference such as a normalized path or record id. */
  evidenceRef?: string;
  observedAt?: number;
};

export function validToolVerification(value: unknown): value is ToolVerificationEvidence {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ToolVerificationEvidence>;
  return (
    (v.state === "verified" || v.state === "contradicted" ||
      v.state === "unavailable" || v.state === "not_applicable") &&
    (v.scope === "operation" || v.scope === "task_outcome") &&
    typeof v.method === "string" && /^[a-z0-9_.-]{1,64}$/i.test(v.method) &&
    typeof v.summary === "string" && v.summary.trim().length > 0 && v.summary.length <= 500 &&
    (v.evidenceRef === undefined || (typeof v.evidenceRef === "string" && v.evidenceRef.length <= 300)) &&
    (v.observedAt === undefined || (Number.isFinite(v.observedAt) && Number(v.observedAt) >= 0))
  );
}

/** Validate and redact at the first shared boundary, before streaming or persistence. */
export function sanitizeToolVerification(value: unknown): ToolVerificationEvidence | null {
  if (!validToolVerification(value)) return null;
  return {
    ...value,
    summary: scrubSecrets(value.summary),
    ...(value.evidenceRef ? { evidenceRef: scrubSecrets(value.evidenceRef) } : {}),
  };
}
