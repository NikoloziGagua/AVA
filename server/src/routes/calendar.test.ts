import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { calendarRoutes } from "./calendar.js";

function app(authorized = true) {
  const db = openInMemoryDb();
  const instance = express();
  instance.use(express.json());
  let clock = Date.parse("2027-01-01T00:00:00Z");
  instance.use("/api/calendar", calendarRoutes(db, authorized
    ? (_req, _res, next) => next()
    : (_req, res) => { res.status(401).json({ error: "missing_token" }); },
  { now: () => clock }));
  return { db, app: instance, setNow: (now: number) => { clock = now; } };
}

const body = {
  title: "Software Engineering",
  kind: "lecture",
  timeZone: "Europe/Dublin",
  anchorLocalDate: "2027-01-11",
  startLocalTime: "09:00:00",
  durationMinutes: 60,
  recurrenceKind: "weekly",
  recurrenceUntilDate: "2027-02-08",
  attendanceIntent: "attend",
};

describe("calendar routes", () => {
  it("requires authentication for read and write", async () => {
    const fixture = app(false);
    await request(fixture.app).get("/api/calendar/events?from=0&to=1").expect(401);
    await request(fixture.app).post("/api/calendar/events").send(body).expect(401);
    await request(fixture.app).patch("/api/calendar/events/cal_missing").send({ expectedVersion: 1 }).expect(401);
    await request(fixture.app).delete("/api/calendar/events/cal_missing?expectedVersion=1").expect(401);
    await request(fixture.app).put("/api/calendar/events/cal_missing/occurrences/2027-01-11")
      .send({ expectedEventVersion: 1 }).expect(401);
    for (const action of ["restore", "end", "extend", "split"]) {
      await request(fixture.app).post(`/api/calendar/events/cal_missing/${action}`).send({}).expect(401);
    }
    expect(fixture.db.prepare("SELECT count(*) AS n FROM calendar_events").get()).toEqual({ n: 0 });
  });

  it("creates, queries, version-updates and archives definitions", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    expect(created.body.event).toMatchObject({ title: body.title, version: 1, source: "manual" });
    const id = created.body.event.id;
    const from = Date.parse("2027-01-01T00:00:00Z"), to = Date.parse("2027-02-20T00:00:00Z");
    const queried = await request(fixture.app).get(`/api/calendar/events?from=${from}&to=${to}`).expect(200);
    expect(queried.body).toMatchObject({ complete: true, window: { from, to, timeZone: "Europe/Dublin" } });
    expect(queried.body.occurrences).toHaveLength(5);
    const updated = await request(fixture.app).patch(`/api/calendar/events/${id}`)
      .send({ expectedVersion: 1, location: "Room 3" }).expect(200);
    expect(updated.body.event).toMatchObject({ version: 2, location: "Room 3" });
    expect(updated.body.changed).toBe(true);
    const stale = await request(fixture.app).patch(`/api/calendar/events/${id}`)
      .send({ expectedVersion: 1, location: "stale" }).expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version" });
    const archived = await request(fixture.app).delete(`/api/calendar/events/${id}?expectedVersion=2`).expect(200);
    expect(archived.body.event).toMatchObject({ version: 3 });
    expect(archived.body.event.archivedAt).toEqual(expect.any(Number));
  });

  it("moves one occurrence, records attendance and splits following occurrences", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    const id = created.body.event.id;
    const exception = await request(fixture.app)
      .put(`/api/calendar/events/${id}/occurrences/2027-01-18`)
      .send({
        expectedEventVersion: 1, expectedExceptionVersion: null,
        movedLocalTime: "11:00:00", attendanceIntentOverride: "skip", attendanceOutcome: "skipped",
      }).expect(200);
    expect(exception.body.exception).toMatchObject({ version: 1, movedLocalTime: "11:00:00", attendanceOutcome: "skipped" });
    expect(exception.body.changed).toBe(true);
    const stale = await request(fixture.app)
      .put(`/api/calendar/events/${id}/occurrences/2027-01-18`)
      .send({ expectedEventVersion: 1, expectedExceptionVersion: null, cancelled: true })
      .expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version" });
    const split = await request(fixture.app).post(`/api/calendar/events/${id}/split`)
      .send({ expectedVersion: 1, splitOriginalDate: "2027-01-25", changes: { startLocalTime: "10:00:00" } })
      .expect(201);
    expect(split.body.previous).toMatchObject({ recurrenceUntilDate: "2027-01-18", version: 2 });
    expect(split.body.changed).toBe(true);
    expect(split.body.next).toMatchObject({
      anchorLocalDate: "2027-01-25", startLocalTime: "10:00:00", splitFromEventId: id,
      recurrenceKind: "weekly", attendanceIntent: "attend",
    });
  });

  it("returns typed bounded errors without reflecting private input", async () => {
    const fixture = app();
    await request(fixture.app).post("/api/calendar/events")
      .send({ ...body, timeZone: "Europe/private-secret" })
      .expect(400, { error: "invalid_timezone", message: "Use a valid named IANA time zone, such as Europe/Dublin." });
    const invalidRange = await request(fixture.app).get("/api/calendar/events?from=0&to=999999999999999").expect(400);
    expect(invalidRange.body.error).toBe("invalid_range");
    const missing = await request(fixture.app).put("/api/calendar/events/cal_missing/occurrences/2027-01-11")
      .send({ expectedEventVersion: 1, expectedExceptionVersion: null, cancelled: true }).expect(404);
    expect(missing.body.error).toBe("not_found");
  });

  it("returns honest changed=false for strict full echoes after the series starts", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    const id = created.body.event.id;
    fixture.setNow(Date.parse("2027-01-20Z"));
    const echo = await request(fixture.app).patch(`/api/calendar/events/${id}`)
      .send({ ...body, expectedVersion: 1 }).expect(200);
    expect(echo.body).toEqual({ event: created.body.event, changed: false });
    const noop = await request(fixture.app).put(`/api/calendar/events/${id}/occurrences/2027-01-11`)
      .send({ expectedEventVersion: 1, expectedExceptionVersion: null, movedLocalDate: null,
        movedLocalTime: null, movedDurationMinutes: null, cancelled: false,
        attendanceIntentOverride: "attend", attendanceOutcome: "unknown" }).expect(200);
    expect(noop.body).toEqual({ exception: null, changed: false });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM calendar_event_exceptions").get()).toEqual({ n: 0 });
    await request(fixture.app).patch(`/api/calendar/events/${id}`).send({ ...body, expectedVersion: 2 }).expect(409);
    await request(fixture.app).put(`/api/calendar/events/${id}/occurrences/2027-01-11`)
      .send({ expectedEventVersion: 1, expectedExceptionVersion: 5 }).expect(409);
    const changed = await request(fixture.app).patch(`/api/calendar/events/${id}`)
      .send({ ...body, expectedVersion: 1, reminderMinutesBefore: 15 }).expect(200);
    expect(changed.body).toMatchObject({ changed: true, event: { version: 2, reminderMinutesBefore: 15 } });
    const refused = await request(fixture.app).patch(`/api/calendar/events/${id}`)
      .send({ ...body, expectedVersion: 2, startLocalTime: "10:00:00" }).expect(400);
    expect(refused.body.error).toBe("series_started");
  });

  it("ends and undoes exactly, archives with an explicit history flag and restores", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    const id = created.body.event.id;
    await request(fixture.app).put(`/api/calendar/events/${id}/occurrences/2027-02-01`)
      .send({ expectedEventVersion: 1, cancelled: true }).expect(200);
    fixture.setNow(Date.parse("2027-01-20Z"));
    const ended = await request(fixture.app).post(`/api/calendar/events/${id}/end`)
      .send({ expectedVersion: 1, fromOriginalDate: "2027-01-25" }).expect(200);
    expect(ended.body).toMatchObject({ event: { id, version: 2, recurrenceUntilDate: "2027-01-18" },
      endedFromOriginalDate: "2027-01-25", previousRecurrenceUntilDate: body.recurrenceUntilDate });
    await request(fixture.app).post(`/api/calendar/events/${id}/end`)
      .send({ expectedVersion: 1, fromOriginalDate: "2027-01-25" }).expect(409);
    const extended = await request(fixture.app).post(`/api/calendar/events/${id}/extend`)
      .send({ expectedVersion: ended.body.event.version, recurrenceUntilDate: ended.body.previousRecurrenceUntilDate }).expect(200);
    expect(extended.body).toMatchObject({ event: { id, version: 3, recurrenceUntilDate: body.recurrenceUntilDate }, previousRecurrenceUntilDate: "2027-01-18" });
    const refused = await request(fixture.app).delete(`/api/calendar/events/${id}?expectedVersion=3`).expect(400);
    expect(refused.body.error).toBe("series_started");
    const archive = await request(fixture.app).delete(`/api/calendar/events/${id}?expectedVersion=3&includeHistory=true`).expect(200);
    expect(archive.body.event.version).toBe(4);
    const range = `from=${Date.parse("2027-01-01Z")}&to=${Date.parse("2027-03-01Z")}`;
    const hidden = await request(fixture.app).get(`/api/calendar/events?${range}`).expect(200);
    expect(hidden.body.occurrences).toEqual([]);
    expect(hidden.body.events).toEqual([]);
    const replay = await request(fixture.app).delete(`/api/calendar/events/${id}?expectedVersion=4`).expect(200);
    expect(replay.body).toEqual(archive.body);
    await request(fixture.app).post(`/api/calendar/events/${id}/restore`).send({ expectedVersion: 3 }).expect(409);
    const restored = await request(fixture.app).post(`/api/calendar/events/${id}/restore`).send({ expectedVersion: 4 }).expect(200);
    expect(restored.body.event).toMatchObject({ version: 5, archivedAt: null });
    const visible = await request(fixture.app).get(`/api/calendar/events?${range}`).expect(200);
    expect(visible.body.occurrences).toHaveLength(5);
    expect(visible.body.occurrences.find((o: { originalLocalDate: string }) => o.originalLocalDate === "2027-02-01"))
      .toMatchObject({ cancelled: true, exceptionVersion: 1 });
    const notArchived = await request(fixture.app).post(`/api/calendar/events/${id}/restore`).send({ expectedVersion: 5 }).expect(400);
    expect(notArchived.body.error).toBe("not_archived");
  });

  it("rejects unknown HTTP mutation fields instead of silently accepting a cancellation", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    const id = created.body.event.id;
    await request(fixture.app).post("/api/calendar/events").send({ ...body, privatePayload: "secret-sentinel" }).expect(400);
    await request(fixture.app).patch(`/api/calendar/events/${id}`).send({ expectedVersion: 1, cancelled: true }).expect(400);
    await request(fixture.app).post(`/api/calendar/events/${id}/split`)
      .send({ expectedVersion: 1, splitOriginalDate: "2027-01-25", changes: { cancelled: true, title: "new" } }).expect(400);
    await request(fixture.app).put(`/api/calendar/events/${id}/occurrences/2027-01-11`)
      .send({ expectedEventVersion: 1, title: "new" }).expect(400);
    for (const action of ["end", "extend", "restore"]) {
      const bad = await request(fixture.app).post(`/api/calendar/events/${id}/${action}`)
        .send({ expectedVersion: 1, fromOriginalDate: "2027-01-25", recurrenceUntilDate: "2027-03-01", privatePayload: "secret-sentinel" }).expect(400);
      expect(JSON.stringify(bad.body)).not.toContain("secret-sentinel");
    }
    expect(fixture.db.prepare("SELECT version FROM calendar_events").all()).toEqual([{ version: 1 }]);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM calendar_event_exceptions").get()).toEqual({ n: 0 });
  });

  it.each(["", "expectedVersion=0", "expectedVersion=NaN", "expectedVersion=1.5", "expectedVersion=1&expectedVersion=2",
    "expectedVersion=1&includeHistory=yes", "expectedVersion=1&includeHistory=true&extra=value"]) (
    "rejects malformed archive query %s without a write", async (query) => {
      const fixture = app();
      const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
      await request(fixture.app).delete(`/api/calendar/events/${created.body.event.id}?${query}`).expect(400);
      expect(fixture.db.prepare("SELECT version,archived_at FROM calendar_events").get()).toEqual({ version: 1, archived_at: null });
    },
  );

  it("keeps exact typed conflict/status errors and does not leak request values", async () => {
    const fixture = app();
    const created = await request(fixture.app).post("/api/calendar/events").send(body).expect(201);
    const id = created.body.event.id;
    await request(fixture.app).put(`/api/calendar/events/${id}/occurrences/2027-02-01`)
      .send({ expectedEventVersion: 1, movedLocalDate: "2027-01-12" }).expect(200);
    fixture.setNow(Date.parse("2027-01-20Z"));
    const conflict = await request(fixture.app).post(`/api/calendar/events/${id}/end`)
      .send({ expectedVersion: 1, fromOriginalDate: "2027-01-25" }).expect(400);
    expect(conflict.body.error).toBe("history_conflict");
    expect(JSON.stringify(conflict.body)).not.toContain(id);
    const badDate = await request(fixture.app).post(`/api/calendar/events/${id}/end`)
      .send({ expectedVersion: 1, fromOriginalDate: "2027-01-26" }).expect(404);
    expect(badDate.body.error).toBe("occurrence_not_found");
    const missing = await request(fixture.app).post("/api/calendar/events/cal_missing/restore").send({ expectedVersion: 1 }).expect(404);
    expect(missing.body.error).toBe("not_found");
    await request(fixture.app).post(`/api/calendar/events/${id}/end`)
      .send({ expectedVersion: 1, fromOriginalDate: "2027-02-30" }).expect(400);
    await request(fixture.app).post(`/api/calendar/events/${id}/extend`)
      .send({ expectedVersion: 1, recurrenceUntilDate: "bogus" }).expect(400);
    expect(fixture.db.prepare("SELECT version FROM calendar_events").get()).toEqual({ version: 1 });
  });
});
