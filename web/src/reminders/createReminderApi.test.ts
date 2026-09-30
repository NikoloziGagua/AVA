// A create only counts as saved when AVA's answer proves this exact reminder
// was stored (contract i4-one-off-reminders v2, review #386/#387).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/tokens.js", () => ({ getToken: () => "token", clearToken: () => {} }));

import { ApiError, createReminderApi, UnconfirmedWriteError } from "../api.js";
import { createOutcomeUnknown } from "./createErrors.js";

const RUN_AT = Date.UTC(2026, 9, 30, 9, 0);
const INPUT = { prompt: "Hand in the essay", runAt: RUN_AT, timeZone: "Europe/London" };

function stored(over: Record<string, unknown> = {}, receipt: Record<string, unknown> = {}) {
  const id = (over.id as string | undefined) ?? "abc123";
  const runAt = (over.run_at as number | undefined) ?? RUN_AT;
  return {
    id, prompt: INPUT.prompt, kind: "reminder", run_at: runAt, time_zone: "Europe/London",
    interval_minutes: 1440, once: 1, enabled: 1, session_id: null, created_at: 1,
    last_run_at: null, last_status: null, last_result: null,
    reminder_status: {
      version: 1, occurrenceId: `reminder:${id}:${runAt}`, revision: 1, state: "scheduled", dueAt: runAt,
      timeZone: "Europe/London", expiresAt: runAt + 900_000, attempts: 0, attemptedAt: null, nextAttemptAt: runAt,
      acceptedAt: null, subscriptions: { total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
      reasonCode: null, phoneReceipt: "unconfirmed", ...receipt,
    },
    ...over,
  };
}

function respond(status: number, body: unknown, raw = false) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(raw ? String(body) : JSON.stringify(body), { status })));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("createReminderApi", () => {
  it("resolves with the stored reminder when the answer proves it", async () => {
    respond(200, { watch: stored() });
    await expect(createReminderApi(INPUT)).resolves.toMatchObject({ id: "abc123", run_at: RUN_AT });
  });

  it("sends the exact v2 body", async () => {
    respond(200, { watch: stored() });
    await createReminderApi(INPUT);
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: INPUT.prompt, kind: "reminder", run_at: RUN_AT, time_zone: "Europe/London", once: true,
    });
  });

  const unproven: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["null", null],
    ["a different instant", { watch: stored({ run_at: RUN_AT + 60_000 }) }],
    ["a different prompt", { watch: stored({ prompt: "Something else" }) }],
    ["a different kind", { watch: stored({ kind: "check" }) }],
    ["a different zone", { watch: stored({ time_zone: "America/New_York" }) }],
    ["no receipt", { watch: stored({ reminder_status: undefined }) }],
    ["a receipt for another occurrence", { watch: stored({}, { occurrenceId: "reminder:other:1" }) }],
    ["a receipt that isn't scheduled", { watch: stored({}, { state: "failed", reasonCode: "permanent_rejection" }) }],
    ["a malformed id", { watch: stored({ id: "../x" }) }],
  ];
  for (const [what, body] of unproven) {
    it(`treats a 2xx with ${what} as unconfirmed, never as saved`, async () => {
      respond(200, body);
      const error = await createReminderApi(INPUT).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(UnconfirmedWriteError);
      expect(createOutcomeUnknown(error)).toBe(true);
    });
  }

  it("treats an unreadable 2xx body as unconfirmed", async () => {
    respond(200, "<html>proxy page</html>", true);
    const error = await createReminderApi(INPUT).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UnconfirmedWriteError);
  });

  it("accepts an equivalent canonical zone spelled differently", async () => {
    const canonical = (zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    expect(canonical("Etc/UTC")).toBe(canonical("UTC"));
    respond(200, { watch: stored({ time_zone: "UTC" }) });
    await expect(createReminderApi({ ...INPUT, timeZone: "Etc/UTC" })).resolves.toMatchObject({ id: "abc123" });
  });

  it("passes a definite refusal through with its reason code", async () => {
    respond(400, { error: "bad_request", reasonCode: "run_at_not_future" });
    const error = await createReminderApi(INPUT).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reasonCode).toBe("run_at_not_future");
    expect(createOutcomeUnknown(error)).toBe(false);
  });

  it("drops a reason code that isn't a bounded code", async () => {
    respond(400, { error: "bad_request", reasonCode: "<script>" });
    const error = await createReminderApi(INPUT).catch((cause: unknown) => cause);
    expect((error as ApiError).reasonCode).toBeNull();
  });
});
