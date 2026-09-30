import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import type { MemoryArchive } from "../memory-archive/archive.js";
import { memoryV2Enabled } from "../memory-archive/brief.js";
import type { MemoryRecord, MemoryWriteFailure } from "../memory-archive/types.js";
import { scrubSecrets } from "../security/scrub.js";

const Version = { expectedVersion: z.number().int().positive() };
const VersionBody = z.object(Version).strict();
const CorrectBody = z.object({ ...Version, text: z.string().trim().min(1).max(600) }).strict();
const CarryBody = z.object({ ...Version, carry: z.boolean() }).strict();

/** What the Memory tab sees of a record: never its fingerprints or raw message ids. */
function view(record: MemoryRecord) {
  return {
    id: record.id, kind: record.kind, topic: record.topic, text: record.text, speechAct: record.speechAct,
    status: record.status, carry: record.carry, sensitive: record.sensitive, confidence: record.confidence,
    origin: record.origin, saidAt: record.saidAt, validTo: record.validTo, dueAt: record.dueAt,
    supersedesId: record.supersedesId, supersededById: record.supersededById,
    hasSources: record.sourceMessageIds.length > 0, version: record.version,
  };
}

const EXCERPT_FILLER = new Set(["the", "and", "that", "this", "with", "for", "his", "her", "niko", "ava", "sir", "you", "was", "are", "has", "have"]);
const contentWords = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")
  .filter((word) => word.length >= 3 && !EXCERPT_FILLER.has(word)));

/** The part of a long message that says what the memory records, so a voice transcript stays readable. */
export function excerpt(content: string, recordText: string, max = 280): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const wanted = contentWords(recordText);
  const scores = sentences.map((sentence) => [...contentWords(sentence)].filter((word) => wanted.has(word)).length);
  let first = scores.indexOf(Math.max(...scores)), last = first;
  let length = sentences[first]!.length;
  while (true) {
    const before = first > 0 ? sentences[first - 1]!.length + 1 : Infinity;
    const after = last < sentences.length - 1 ? sentences[last + 1]!.length + 1 : Infinity;
    if (Math.min(before, after) + length > max) break;
    if (after <= before) { last += 1; length += after; } else { first -= 1; length += before; }
  }
  let body = sentences.slice(first, last + 1).join(" ");
  let lead = first > 0, tail = last < sentences.length - 1;
  if (body.length > max) {
    // One long run-on sentence, as voice transcripts often are: a window around the first matching word.
    const lower = body.toLowerCase();
    const hits = [...wanted].map((word) => lower.indexOf(word)).filter((at) => at >= 0);
    let start = hits.length ? Math.max(0, Math.min(Math.min(...hits) - Math.floor(max / 4), body.length - max)) : 0;
    const space = start > 0 ? body.indexOf(" ", start) : -1;
    if (space >= 0 && space < start + 20) start = space + 1;
    const end = Math.min(body.length, start + max - 2);
    lead ||= start > 0; tail ||= end < body.length;
    body = body.slice(start, end).trim();
  }
  return `${lead ? "…" : ""}${body}${tail ? "…" : ""}`;
}

function sendFailure(res: Response, failure: MemoryWriteFailure): void {
  const status = failure.reason === "not_found" ? 404 : failure.reason === "invalid" ? 400 : 409;
  const error = failure.reason === "not_found" ? "memory_not_found" : failure.reason === "stale" ? "stale_version" : failure.reason;
  res.status(status).json({ error, message: failure.message });
}

export type MemoryArchiveRoutesDeps = { db: Db; archive: MemoryArchive };

/**
 * The Memory tab over memory v2. Every change here is Niko's own, made in the
 * app (actor niko, no conversation), and names the version he was looking at:
 * a record AVA changed in the meantime is refused, never overwritten.
 */
export function memoryArchiveRoutes(auth: RequestHandler, deps: MemoryArchiveRoutesDeps): Router {
  const r = Router();
  const { archive, db } = deps;
  const message = db.prepare("SELECT id, session_id, role, content, created_at FROM messages WHERE id = ?");

  r.get("/", auth, (_req, res) => {
    res.json({
      enabled: memoryV2Enabled(),
      fetchedAt: Date.now(),
      records: [...archive.current(), ...archive.unconfirmed()].map(view),
      history: archive.history(300).map(view),
      events: archive.events({ limit: 12 }).map((event) => ({
        seq: event.seq, recordId: event.recordId, action: event.action, actor: event.actor,
        summary: event.summary, createdAt: event.createdAt,
      })),
      counts: archive.counts(),
    });
  });

  r.get("/search", auth, (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const hits = query ? archive.search(query, { limit: 40, includeHistory: true, includeUnconfirmed: true }) : [];
    res.json({ query, hits: hits.map((hit) => view(hit.record)) });
  });

  r.get("/:id", auth, (req, res) => {
    const record = archive.get(String(req.params.id));
    if (!record) { res.status(404).json({ error: "memory_not_found" }); return; }
    // Never quote a line whose content Niko asked AVA to forget.
    const forgotten = archive.forgottenMessageIds(record.sourceMessageIds);
    const sources = record.sourceMessageIds.filter((id) => !forgotten.has(id)).slice(0, 3)
      .map((id) => message.get(id) as { id: number; session_id: string; role: string; content: string; created_at: number } | undefined)
      .filter((row): row is NonNullable<typeof row> => !!row)
      .map((row) => ({
        id: row.id, sessionId: row.session_id, speaker: row.role === "user" ? "niko" : "ava",
        text: scrubSecrets(excerpt(row.content, record.text)), at: row.created_at,
      }));
    res.json({ record: view(record), chain: archive.chain(record.id).filter((item) => item.id !== record.id).map(view), sources });
  });

  r.post("/:id/correct", auth, (req, res) => {
    const parsed = CorrectBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = archive.correct(String(req.params.id), {
      text: parsed.data.text, saidAt: Date.now(), origin: "explicit", speechAct: "stated",
      expectedVersion: parsed.data.expectedVersion,
    }, "niko", null);
    if (!result.ok) { sendFailure(res, result); return; }
    res.json({ record: view(result.record), outcome: result.outcome });
  });

  r.post("/:id/carry", auth, (req, res) => {
    const parsed = CarryBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = archive.setCarry(String(req.params.id), parsed.data.carry, "niko", { expectedVersion: parsed.data.expectedVersion, sessionId: null });
    if (!result.ok) { sendFailure(res, result); return; }
    res.json({ record: view(result.record) });
  });

  r.post("/:id/confirm", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = archive.confirm(String(req.params.id), "niko", null, { expectedVersion: parsed.data.expectedVersion });
    if (!result.ok) { sendFailure(res, result); return; }
    res.json({ record: view(result.record) });
  });

  // Permanent, so it has its own route and always names the version on screen.
  // Dropping a record that was waiting for Niko is the same erase, logged as rejected.
  r.post("/:id/forget", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const id = String(req.params.id);
    const waiting = archive.get(id)?.status === "unconfirmed";
    const result = archive.forget(id, "niko", { reason: waiting ? "rejected" : "forgotten", sessionId: null, expectedVersion: parsed.data.expectedVersion });
    if (!result.ok) { sendFailure(res, result); return; }
    res.json({ ok: true, forgotten: result.forgotten });
  });

  return r;
}
