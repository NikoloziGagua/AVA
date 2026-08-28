import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { readMemoryView } from "../memory/file-view.js";
import { editLine, deleteLine, appendLineTo } from "../memory/edit-lines.js";
import { MemoryIndexService } from "../memory-index/store.js";
import { CONVERSATION_MEMORY_KINDS, MEMORY_PRIVACY_LEVELS } from "../memory-index/types.js";

const PatchBody = z.object({
  file: z.enum(["preferences", "observations"]),
  oldLine: z.string().min(1),
  newLine: z.string().optional(),
});

const PostBody = z.object({
  file: z.literal("preferences"),
  line: z.string().min(1).max(2000),
});

const CaptureIndexBody = z.object({
  sessionId: z.string().min(1).max(160),
  fromMessageId: z.number().int().positive(),
  throughMessageId: z.number().int().positive(),
  kind: z.enum(CONVERSATION_MEMORY_KINDS),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(6_000),
  conclusions: z.array(z.string().max(600)).max(12).optional(),
  openQuestions: z.array(z.string().max(600)).max(12).optional(),
  nextSteps: z.array(z.string().max(600)).max(12).optional(),
  tags: z.array(z.string().max(80)).max(16).optional(),
  project: z.string().max(80).nullish(),
  privacyLevel: z.enum(MEMORY_PRIVACY_LEVELS).optional(),
}).strict();

const SearchIndexBody = z.object({
  query: z.string().min(1).max(1_000),
  project: z.string().max(80).nullish(),
  limit: z.number().int().min(1).max(20).optional(),
  includeHistory: z.boolean().optional(),
}).strict();

const ForgetIndexBody = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

const GovernanceBase = {
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  requestId: z.string().min(8).max(160).regex(/^[A-Za-z0-9:_-]+$/),
  project: z.string().max(80).nullish(),
};

const CorrectionBody = z.object({
  ...GovernanceBase,
  correction: z.object({
    title: z.string().min(1).max(160).optional(),
    summary: z.string().min(1).max(6_000).optional(),
    conclusions: z.array(z.string().max(600)).max(12).optional(),
    openQuestions: z.array(z.string().max(600)).max(12).optional(),
    nextSteps: z.array(z.string().max(600)).max(12).optional(),
    tags: z.array(z.string().max(80)).max(16).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, { message: "correction is empty" }),
}).strict();

const PinBody = z.object({
  ...GovernanceBase,
  pinned: z.boolean(),
}).strict();

const SupersedeBody = z.object({
  ...GovernanceBase,
  replacementThreadId: z.string().min(1).max(160),
  replacementExpectedVersion: z.number().int().positive(),
}).strict();

const ConflictBody = z.object({
  ...GovernanceBase,
  otherThreadId: z.string().min(1).max(160),
  otherExpectedVersion: z.number().int().positive(),
}).strict();

const ResolveConflictBody = z.object({
  ...GovernanceBase,
  losingThreadId: z.string().min(1).max(160),
  losingExpectedVersion: z.number().int().positive(),
}).strict();

function sendGovernance(res: Response, result: ReturnType<MemoryIndexService["setPinned"]>): void {
  if (result.ok) { res.json(result); return; }
  const status = result.reason === "not_found" || result.reason === "privacy_scope" ? 404 : 409;
  res.status(status).json({
    error: result.reason === "version_conflict" ? "stale_version" : result.reason,
    currentVersion: result.currentVersion,
    message: result.message,
  });
}

export type MemoryRoutesDeps = { memoryDir: string; index?: MemoryIndexService };

export function memoryRoutes(auth: RequestHandler, deps: MemoryRoutesDeps): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json(readMemoryView(deps.memoryDir));
  });

  r.get("/index", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const project = typeof req.query.project === "string" ? req.query.project : undefined;
    res.json(deps.index.listRecent({ project, limit }));
  });

  r.post("/index/capture", auth, async (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const parsed = CaptureIndexBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = await deps.index.capture(parsed.data);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found/i.test(message) ? 404 : /forgotten/i.test(message) ? 409 : 400;
      res.status(status).json({ error: "memory_capture_failed", message });
    }
  });

  r.post("/index/search", auth, async (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const parsed = SearchIndexBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await deps.index.search(parsed.data.query, {
        project: parsed.data.project,
        limit: parsed.data.limit,
        includeHistory: parsed.data.includeHistory,
      }));
    } catch (error) {
      res.status(400).json({
        error: "memory_search_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  r.get("/index/:id", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const project = typeof req.query.project === "string" ? req.query.project : undefined;
    const result = id ? deps.index.get(id, { project }) : null;
    if (!result) { res.status(404).json({ error: "memory_not_found" }); return; }
    res.json({ result });
  });

  r.post("/index/:id/correct", auth, async (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = CorrectionBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request", details: parsed.success ? undefined : parsed.error.flatten() }); return; }
    const current = deps.index.get(id, { project: parsed.data.project });
    if (!current) { res.status(404).json({ error: "memory_not_found" }); return; }
    const result = await deps.index.correct({
      threadId: current.lineage.threadId,
      entryId: id,
      expectedVersion: parsed.data.expectedVersion,
      actor: "user",
      reason: parsed.data.reason,
      requestKey: parsed.data.requestId,
      project: parsed.data.project,
      correction: parsed.data.correction,
    });
    sendGovernance(res, result);
  });

  r.post("/index/threads/:threadId/pin", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const threadId = typeof req.params.threadId === "string" ? req.params.threadId : "";
    const parsed = PinBody.safeParse(req.body);
    if (!threadId || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    sendGovernance(res, deps.index.setPinned({
      threadId,
      expectedVersion: parsed.data.expectedVersion,
      actor: "user",
      reason: parsed.data.reason,
      requestKey: parsed.data.requestId,
      project: parsed.data.project,
      pinned: parsed.data.pinned,
    }));
  });

  r.post("/index/threads/:threadId/supersede", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const threadId = typeof req.params.threadId === "string" ? req.params.threadId : "";
    const parsed = SupersedeBody.safeParse(req.body);
    if (!threadId || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    sendGovernance(res, deps.index.supersede({ threadId, actor: "user", ...parsed.data, requestKey: parsed.data.requestId }));
  });

  r.post("/index/threads/:threadId/conflict", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const threadId = typeof req.params.threadId === "string" ? req.params.threadId : "";
    const parsed = ConflictBody.safeParse(req.body);
    if (!threadId || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    sendGovernance(res, deps.index.openConflict({ threadId, actor: "user", ...parsed.data, requestKey: parsed.data.requestId }));
  });

  r.post("/index/threads/:threadId/resolve-conflict", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const threadId = typeof req.params.threadId === "string" ? req.params.threadId : "";
    const parsed = ResolveConflictBody.safeParse(req.body);
    if (!threadId || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    sendGovernance(res, deps.index.resolveConflict({ threadId, actor: "user", ...parsed.data, requestKey: parsed.data.requestId }));
  });

  r.post("/index/:id/forget", auth, (req, res) => {
    if (!deps.index) { res.status(503).json({ error: "memory_index_unavailable" }); return; }
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = ForgetIndexBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = deps.index.forget(id, parsed.data.expectedVersion);
    if (!result.ok) {
      res.status(result.reason === "not_found" ? 404 : 409).json({
        error: result.reason === "not_found" ? "memory_not_found" : "stale_version",
        currentVersion: result.currentVersion,
      });
      return;
    }
    res.json({ ok: true });
  });

  r.patch("/lines", auth, (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const { file, oldLine, newLine } = parsed.data;
    if (typeof newLine === "string" && newLine.length > 0) {
      const r1 = editLine({ memoryDir: deps.memoryDir, file, oldLine, newLine });
      if (r1.kind === "stale") {
        res.status(409).json({ error: "stale_line", current: r1.current });
        return;
      }
      res.json({ line: newLine });
      return;
    }
    const r2 = deleteLine({ memoryDir: deps.memoryDir, file, oldLine });
    if (r2.kind === "stale") {
      res.status(409).json({ error: "stale_line", current: r2.current });
      return;
    }
    res.json({ deleted: true });
  });

  r.post("/lines", auth, (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    appendLineTo({
      memoryDir: deps.memoryDir, file: "preferences", line: parsed.data.line,
    });
    res.json({ line: parsed.data.line });
  });

  return r;
}
