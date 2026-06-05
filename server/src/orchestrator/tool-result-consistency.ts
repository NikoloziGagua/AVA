/**
 * Action-tool result consistency.
 *
 * After an action tool runs, its result tells us whether the work actually
 * succeeded. The model, left alone, will sometimes narrate a confident
 * "Done, Sir." even when the underlying tool reported a failure or only made
 * partial progress. This module classifies a tool result so the orchestrator
 * can inject a final reminder that forbids success phrasing when the evidence
 * doesn't support it.
 *
 * Classification (worst wins):
 *   - "error":     hard failure — is_error, ok:false, success:false, a nonzero
 *                  exit/exitCode/code, a truthy `error` field, or status "failed".
 *   - "uncertain": ambiguous/incomplete — status "partial" or "uncertain".
 *   - "ok":        no failure or uncertainty signal found.
 */

export type ActionResultClass = "error" | "uncertain" | "ok";

/** The minimal shape we inspect — a dispatched tool result (or a denied one). */
export type InspectableResult = { output: string; is_error?: boolean };

const ERROR_STATUSES = new Set(["failed", "failure", "error", "errored"]);
const UNCERTAIN_STATUSES = new Set(["partial", "uncertain", "unknown", "incomplete"]);

/** Numeric fields that carry an exit-code convention (nonzero = failure). */
const EXIT_FIELDS = ["exitCode", "exit_code", "code", "exit", "returnCode", "return_code"];

export function classifyActionResult(result: InspectableResult): ActionResultClass {
  // The transport already flagged this as an error (timeout, throw, policy deny).
  if (result.is_error) return "error";

  const parsed = tryParseJson(result.output);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return classifyObject(parsed as Record<string, unknown>);
  }
  return "ok";
}

/**
 * Reduce a set of per-result classes to the single worst one.
 * error > uncertain > ok.
 */
export function worstClass(classes: ActionResultClass[]): ActionResultClass {
  if (classes.includes("error")) return "error";
  if (classes.includes("uncertain")) return "uncertain";
  return "ok";
}

function classifyObject(obj: Record<string, unknown>): ActionResultClass {
  // Explicit boolean success flags.
  if (obj.ok === false) return "error";
  if (obj.success === false) return "error";

  // A populated `error` field is a failure regardless of other flags.
  if (isTruthyError(obj.error)) return "error";

  // Exit-code conventions: any nonzero numeric exit field is a failure.
  for (const field of EXIT_FIELDS) {
    const v = obj[field];
    if (typeof v === "number" && v !== 0) return "error";
  }

  // Status strings.
  const status = typeof obj.status === "string" ? obj.status.toLowerCase().trim() : "";
  if (ERROR_STATUSES.has(status)) return "error";
  if (UNCERTAIN_STATUSES.has(status)) return "uncertain";

  return "ok";
}

function isTruthyError(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().length > 0;
  // Objects/arrays/numbers under an `error` key indicate a real error payload.
  return true;
}

function tryParseJson(s: string): unknown {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Marker prefix on the injected reminder, so it's identifiable in tests/logs. */
export const CONSISTENCY_REMINDER_MARKER = "[RESULT CHECK]";

/**
 * The reminder injected before the model produces its final wording when a
 * recent action-tool result failed or was only partial/uncertain.
 */
export function buildConsistencyReminder(worst: ActionResultClass): string {
  if (worst === "error") {
    return `${CONSISTENCY_REMINDER_MARKER} A recent action tool reported a FAILURE. Do not claim the task is complete or successful. Explicitly tell Sir what failed, and report any partial progress you did make. Be honest about the failure.`;
  }
  return `${CONSISTENCY_REMINDER_MARKER} A recent action tool returned an uncertain or only partial result. Do not claim the task is complete or fully successful. Explicitly report what is uncertain or incomplete, and describe the partial progress made.`;
}
