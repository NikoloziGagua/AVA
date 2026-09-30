import { ApiError, UnconfirmedWriteError } from "../api.js";

/** Honest copy for the server's bounded create-validation codes (i4 v2). */
const CREATE_REASON_COPY: Record<string, string> = {
  invalid_run_at: "AVA couldn't read that time. Choose it again.",
  run_at_not_future: "That time has already passed. Choose a time in the future.",
  run_at_too_far: "Choose a time within the next year.",
  invalid_time_zone: "AVA didn't recognise this device's time zone, so it didn't save the reminder.",
  conflicting_schedule: "A reminder can have only one time. Nothing was saved.",
  invalid_at: "AVA couldn't read that time. Choose it again.",
  invalid_local_date: "That date doesn't exist. Choose another.",
  time_zone_offset_mismatch: "That time doesn't match the time zone's clock on that date. Choose it again.",
};

/** A definite refusal in plain words; unknown codes never show raw server text. */
export function createErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    return (error.reasonCode && CREATE_REASON_COPY[error.reasonCode])
      ?? "AVA couldn't accept this reminder. Check the text and the time, then try again.";
  }
  return error instanceof Error ? error.message : "The reminder could not be saved.";
}

/**
 * A failure after which the reminder may or may not have been stored (network
 * or 5xx). The UI never resends automatically and treats no list match as
 * proof either way (contract i4 v2).
 */
export function createOutcomeUnknown(error: unknown): boolean {
  if (error instanceof UnconfirmedWriteError) return true;
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300);
}

/**
 * What to say after an unconfirmed create, depending on whether the list could
 * be refreshed afterwards. A matching row is never presented as proof.
 */
export function unconfirmedCreateMessage(listRefreshed: boolean): string {
  return listRefreshed
    ? "AVA couldn't confirm whether this reminder was saved. The list has been refreshed, but a matching reminder there may not be this one. Check it before saving again, so it isn't added twice."
    : "AVA couldn't confirm whether this reminder was saved, and the list couldn't be refreshed either. Check the list once AVA is reachable, before saving again.";
}
