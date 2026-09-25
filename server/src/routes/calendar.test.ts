import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { calendarRoutes } from "./calendar.js";

function app(authorized = true) {
  const db = openInMemoryDb();
  const instance = express();
  instance.use(express.json());
  instance.use("/api/calendar", calendarRoutes(db, authorized
    ? (_req, _res, next) => next()
    : (_req, res) => { res.status(401).json({ error: "missing_token" }); },
  { now: () => Date.parse("2027-01-01T00:00:00Z") }));
  return { db, app: instance };
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
    const stale = await request(fixture.app)
      .put(`/api/calendar/events/${id}/occurrences/2027-01-18`)
      .send({ expectedEventVersion: 1, expectedExceptionVersion: null, cancelled: true })
      .expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version" });
    const split = await request(fixture.app).post(`/api/calendar/events/${id}/split`)
      .send({ expectedVersion: 1, splitOriginalDate: "2027-01-25", changes: { startLocalTime: "10:00:00" } })
      .expect(201);
    expect(split.body.previous).toMatchObject({ recurrenceUntilDate: "2027-01-18", version: 2 });
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
});
