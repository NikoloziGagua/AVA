import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createIntent, listIntents, getIntent, updateIntent } from "../self/intents.js";
import { setImprovementsPaused, improvementsPaused } from "../self/improver.js";
import {
  SELF_WORKER_PROVIDERS,
  StaleSelfWorkerSelectionError,
  getSelfWorkerSelection,
  setSelfWorkerSelection,
} from "../self/worker-selection.js";
import type { SelfWorkerRegistry } from "../self/workers.js";

// Match the immutable goal budget in buildSelfWorkerExecutionPrompt. The old
// 2,000-character route cap made substantial approved goals impossible to retry
// through the Self screen even though chat-created intents already supported
// them. Reject beyond the worker envelope rather than truncating or paraphrasing.
const Body = z.object({ goal: z.string().min(1).max(8_000) });
const PauseBody = z.object({ paused: z.boolean() });
const WorkerBody = z.object({
  provider: z.enum(SELF_WORKER_PROVIDERS),
  expectedVersion: z.number().int().positive(),
});
const ApproveBody = z.object({
  expectedWorkerVersion: z.number().int().positive().optional(),
});
const ResumeSwapBody = z.object({
  expectedCandidateSha: z.string().regex(/^[a-f0-9]{40}$/i),
  expectedHead: z.string().regex(/^[a-f0-9]{40}$/i),
});

export type SelfRouteDeps = {
  startImprovement: (id: string) => void;
  revert: (id: string) => void;
  /** Cancel a running/queued self-improvement. Returns true if one was cancelled. */
  cancel: (id: string) => boolean;
  /** Approve a plan parked at awaiting_approval → it proceeds to implement. */
  approve: (id: string, worker: ReturnType<typeof getSelfWorkerSelection>) => boolean;
  /** Reject a plan parked at awaiting_approval → it stops without writing code. */
  reject: (id: string) => boolean;
  headSha: () => string;
  resumeSwap: (
    id: string,
    expected: { candidateSha: string; headSha: string },
  ) => { ok: boolean; status?: string; error?: string; currentHead?: string; currentCandidate?: string | null };
  workers: SelfWorkerRegistry;
};

export function selfRoutes(db: Db, auth: RequestHandler, deps: SelfRouteDeps): Router {
  const r = Router();
  r.post("/improve", auth, async (req, res) => {
    const p = Body.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    if (improvementsPaused()) { res.status(409).json({ error: "paused" }); return; }
    const worker = getSelfWorkerSelection(db);
    const state = await deps.workers.availability(worker.provider);
    if (!state.available) {
      res.status(409).json({ error: "worker_unavailable", provider: worker.provider, reason: state.reason });
      return;
    }
    const id = createIntent(db, { trigger: "explicit", goal: p.data.goal, worker });
    deps.startImprovement(id);
    res.json({ id, worker: worker.provider });
  });
  r.get("/", auth, async (_req, res) => {
    const selected = getSelfWorkerSelection(db);
    const options = await deps.workers.listAvailability();
    res.json({
      intents: listIntents(db),
      paused: improvementsPaused(),
      repositoryHead: deps.headSha(),
      worker: { ...selected, options },
    });
  });
  r.post("/worker", auth, async (req, res) => {
    const p = WorkerBody.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    const current = getSelfWorkerSelection(db);
    if (current.version !== p.data.expectedVersion) {
      res.status(409).json({ error: "stale_version", worker: current });
      return;
    }
    const state = await deps.workers.availability(p.data.provider);
    if (!state.available) {
      res.status(409).json({ error: "worker_unavailable", provider: p.data.provider, reason: state.reason });
      return;
    }
    try {
      const selection = setSelfWorkerSelection(db, p.data.provider, p.data.expectedVersion);
      res.json({ worker: selection });
    } catch (error) {
      if (error instanceof StaleSelfWorkerSelectionError) {
        res.status(409).json({ error: "stale_version", worker: error.current });
        return;
      }
      throw error;
    }
  });
  // The Self screen's Pause toggle used to be pure client state — now it
  // actually gates intake (both this API and the self_improve chat tool).
  r.post("/pause", auth, (req, res) => {
    const p = PauseBody.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    setImprovementsPaused(p.data.paused);
    res.json({ paused: improvementsPaused() });
  });
  r.post("/:id/cancel", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const cancelled = deps.cancel(id);
    res.json({ ok: true, cancelled });
  });
  r.post("/:id/approve", auth, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const parsed = ApproveBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const intent = getIntent(db, id);
    if (!intent) { res.status(404).json({ error: "not_found" }); return; }
    if (intent.status !== "awaiting_approval") {
      res.status(409).json({ error: "not_awaiting_approval", status: intent.status });
      return;
    }
    const selected = getSelfWorkerSelection(db);
    if (
      parsed.data.expectedWorkerVersion !== undefined &&
      parsed.data.expectedWorkerVersion !== selected.version
    ) {
      res.status(409).json({ error: "stale_version", worker: selected });
      return;
    }
    const availability = await deps.workers.availability(selected.provider);
    if (!availability.available) {
      res.status(409).json({
        error: "worker_unavailable",
        provider: selected.provider,
        reason: availability.reason,
      });
      return;
    }
    // Availability probing is asynchronous. Re-read the version before locking
    // the plan so a concurrent selector write cannot alter what was approved.
    const current = getSelfWorkerSelection(db);
    if (current.version !== selected.version || current.provider !== selected.provider) {
      res.status(409).json({ error: "stale_version", worker: current });
      return;
    }
    const approved = deps.approve(id, current);
    if (!approved) {
      res.status(409).json({ error: "approval_not_ready" });
      return;
    }
    res.json({ ok: true, approved, worker: current });
  });
  r.post("/:id/reject", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const rejected = deps.reject(id);
    res.json({ ok: true, rejected });
  });
  r.post("/:id/resume-swap", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const parsed = ResumeSwapBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = deps.resumeSwap(id, {
      candidateSha: parsed.data.expectedCandidateSha,
      headSha: parsed.data.expectedHead,
    });
    if (!result.ok) {
      res.status(result.error === "not_found" ? 404 : 409).json(result);
      return;
    }
    res.status(202).json(result);
  });
  r.post("/:id/revert", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const row = getIntent(db, id);
    if (!row?.last_known_good) { res.status(404).json({ error: "no_known_good" }); return; }
    deps.revert(row.id);
    updateIntent(db, row.id, { status: "rolled_back", outcome: "manual revert requested" });
    res.json({ ok: true, revertTo: row.last_known_good });
  });
  return r;
}
