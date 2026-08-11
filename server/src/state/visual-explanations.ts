import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "./db.js";
import {
  VISUAL_EXPLANATION_SCHEMA_VERSION,
  parseMermaidTopology,
  validateVisualExplanation,
  type CreateVisualExplanationInput,
  type VisualStoryboard,
  type VisualTopology,
} from "../visual-explanations/model.js";

export type VisualExplanationSource = "manual" | "ava_chat" | "ava_voice";

type VisualExplanationRow = {
  id: string;
  schema_version: string;
  title: string;
  summary: string;
  mermaid: string;
  storyboard: string;
  fingerprint: string;
  source: VisualExplanationSource;
  source_session_id: string | null;
  source_run_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

export type VisualExplanation = {
  id: string;
  schemaVersion: typeof VISUAL_EXPLANATION_SCHEMA_VERSION;
  title: string;
  summary: string;
  mermaid: string;
  storyboard: VisualStoryboard;
  topology: VisualTopology;
  source: VisualExplanationSource;
  sourceSessionId: string | null;
  sourceRunId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

function fingerprint(
  input: { title: string; summary: string; mermaid: string; storyboard: VisualStoryboard },
  lineage: { source: VisualExplanationSource; sessionId?: string | null; runId?: string | null },
): string {
  return createHash("sha256")
    // Retries in one originating run are idempotent, while an intentionally
    // recreated explanation in a later conversation retains honest lineage.
    .update(JSON.stringify([
      input.title,
      input.summary,
      input.mermaid,
      input.storyboard,
      lineage.source,
      lineage.sessionId ?? null,
      lineage.runId ?? null,
    ]))
    .digest("hex");
}

function rowToVisual(row: VisualExplanationRow): VisualExplanation {
  const storyboard = JSON.parse(row.storyboard) as VisualStoryboard;
  const topology = parseMermaidTopology(row.mermaid).topology;
  return {
    id: row.id,
    schemaVersion: VISUAL_EXPLANATION_SCHEMA_VERSION,
    title: row.title,
    summary: row.summary,
    mermaid: row.mermaid,
    storyboard,
    topology,
    source: row.source,
    sourceSessionId: row.source_session_id,
    sourceRunId: row.source_run_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createVisualExplanation(
  db: Db,
  input: CreateVisualExplanationInput,
  lineage: { source: VisualExplanationSource; sessionId?: string | null; runId?: string | null },
): { visual: VisualExplanation; created: boolean } {
  const valid = validateVisualExplanation(input);
  const digest = fingerprint(valid, lineage);
  const existing = db.prepare("SELECT * FROM visual_explanations WHERE fingerprint = ?")
    .get(digest) as VisualExplanationRow | undefined;
  if (existing) return { visual: rowToVisual(existing), created: false };

  const id = `visual_${nanoid(12)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO visual_explanations (
      id, schema_version, title, summary, mermaid, storyboard, fingerprint,
      source, source_session_id, source_run_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    VISUAL_EXPLANATION_SCHEMA_VERSION,
    valid.title,
    valid.summary,
    valid.mermaid,
    JSON.stringify(valid.storyboard),
    digest,
    lineage.source,
    lineage.sessionId ?? null,
    lineage.runId ?? null,
    now,
    now,
  );
  return { visual: getVisualExplanation(db, id)!, created: true };
}

export function getVisualExplanation(db: Db, id: string): VisualExplanation | null {
  const row = db.prepare("SELECT * FROM visual_explanations WHERE id = ?").get(id) as VisualExplanationRow | undefined;
  return row ? rowToVisual(row) : null;
}

export function listVisualExplanations(db: Db, limit = 40): VisualExplanation[] {
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
  const rows = db.prepare("SELECT * FROM visual_explanations ORDER BY updated_at DESC, id ASC LIMIT ?")
    .all(bounded) as VisualExplanationRow[];
  return rows.map(rowToVisual);
}
