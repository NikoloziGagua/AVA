import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "./db.js";
import {
  VISUAL_MESSAGE_SCHEMA_VERSION,
  StaleVisualRevisionError,
  VisualExplanationValidationError,
  buildAccessibleFallback,
  parseMermaidTopology,
  semanticModelToMermaid,
  topologyToSemanticModel,
  validateVisualExplanation,
  type CreateVisualExplanationInput,
  type VisualAccessibleFallback,
  type VisualMessage,
  type VisualRendererMetadata,
  type VisualSemanticModel,
  type VisualStoryboard,
} from "../visual-explanations/model.js";

export type VisualExplanationSource = "manual" | "ava_chat" | "ava_voice";
export type VisualExplanation = VisualMessage;

type VisualMessageRow = {
  visual_message_id: string;
  revision: number;
  schema_version: string;
  diagram_kind: "flowchart";
  title: string;
  summary: string;
  semantic_model: string;
  storyboard: string;
  renderer: string;
  accessible_fallback: string;
  fingerprint: string;
  source: VisualExplanationSource;
  source_session_id: string | null;
  source_run_id: string | null;
  created_at: number;
};

type LegacyRow = {
  id: string;
  title: string;
  summary: string;
  mermaid: string;
  storyboard: string;
  source: VisualExplanationSource;
  source_session_id: string | null;
  source_run_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

function fingerprint(
  input: ReturnType<typeof validateVisualExplanation>,
  lineage: { source: VisualExplanationSource; sessionId?: string | null; runId?: string | null },
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.title,
      input.summary,
      input.diagramKind,
      input.semanticModel,
      input.storyboard,
      input.revisesVisualMessageId,
      input.expectedRevision,
      lineage.source,
      lineage.sessionId ?? null,
      lineage.runId ?? null,
    ]))
    .digest("hex");
}

function rowToVisual(row: VisualMessageRow): VisualMessage {
  return {
    schemaVersion: VISUAL_MESSAGE_SCHEMA_VERSION,
    visualMessageId: row.visual_message_id,
    revision: row.revision,
    diagramKind: row.diagram_kind,
    title: row.title,
    summary: row.summary,
    semanticModel: JSON.parse(row.semantic_model) as VisualSemanticModel,
    storyboard: JSON.parse(row.storyboard) as VisualStoryboard,
    renderer: JSON.parse(row.renderer) as VisualRendererMetadata,
    accessibleFallback: JSON.parse(row.accessible_fallback) as VisualAccessibleFallback,
    source: row.source,
    sourceSessionId: row.source_session_id,
    sourceRunId: row.source_run_id,
    createdAt: row.created_at,
  };
}

function legacyToVisual(row: LegacyRow): VisualMessage {
  const topology = parseMermaidTopology(row.mermaid).topology;
  const semanticModel = topologyToSemanticModel(topology);
  const storyboard = JSON.parse(row.storyboard) as VisualStoryboard;
  const renderer: VisualRendererMetadata = {
    renderer: "mermaid",
    rendererSchemaVersion: "1.0",
    generatedFrom: "semantic_model",
    payload: semanticModelToMermaid(semanticModel),
  };
  return {
    schemaVersion: VISUAL_MESSAGE_SCHEMA_VERSION,
    visualMessageId: row.id,
    revision: Math.max(1, row.version),
    diagramKind: "flowchart",
    title: row.title,
    summary: row.summary,
    semanticModel,
    storyboard,
    renderer,
    accessibleFallback: buildAccessibleFallback(row.title, row.summary, semanticModel, storyboard),
    source: row.source,
    sourceSessionId: row.source_session_id,
    sourceRunId: row.source_run_id,
    createdAt: row.updated_at || row.created_at,
  };
}

function getCurrentRow(db: Db, id: string): VisualMessageRow | undefined {
  return db.prepare(`
    SELECT * FROM visual_message_revisions
    WHERE visual_message_id = ?
    ORDER BY revision DESC LIMIT 1
  `).get(id) as VisualMessageRow | undefined;
}

export function createVisualExplanation(
  db: Db,
  input: CreateVisualExplanationInput,
  lineage: { source: VisualExplanationSource; sessionId?: string | null; runId?: string | null },
): { visual: VisualMessage; created: boolean } {
  const valid = validateVisualExplanation(input);
  const digest = fingerprint(valid, lineage);
  const retried = db.prepare("SELECT * FROM visual_message_revisions WHERE fingerprint = ?")
    .get(digest) as VisualMessageRow | undefined;
  if (retried) return { visual: rowToVisual(retried), created: false };

  return db.transaction(() => {
    // Check once more inside the write transaction for simultaneous retries.
    const duplicate = db.prepare("SELECT * FROM visual_message_revisions WHERE fingerprint = ?")
      .get(digest) as VisualMessageRow | undefined;
    if (duplicate) return { visual: rowToVisual(duplicate), created: false };

    let visualMessageId = `visual_${nanoid(12)}`;
    let revision = 1;
    if (valid.revisesVisualMessageId) {
      visualMessageId = valid.revisesVisualMessageId;
      const current = getCurrentRow(db, visualMessageId);
      const currentRevision = current?.revision
        ?? (db.prepare("SELECT version FROM visual_explanations WHERE id = ?").get(visualMessageId) as { version: number } | undefined)?.version;
      if (!currentRevision) throw new VisualExplanationValidationError(["visual message to revise was not found"]);
      if (currentRevision !== valid.expectedRevision) throw new StaleVisualRevisionError(currentRevision);
      revision = currentRevision + 1;
    }

    const now = Date.now();
    db.prepare(`
      INSERT INTO visual_message_revisions (
        visual_message_id, revision, schema_version, diagram_kind, title, summary,
        semantic_model, storyboard, renderer, accessible_fallback, fingerprint,
        source, source_session_id, source_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      visualMessageId,
      revision,
      VISUAL_MESSAGE_SCHEMA_VERSION,
      valid.diagramKind,
      valid.title,
      valid.summary,
      JSON.stringify(valid.semanticModel),
      JSON.stringify(valid.storyboard),
      JSON.stringify(valid.renderer),
      JSON.stringify(valid.accessibleFallback),
      digest,
      lineage.source,
      lineage.sessionId ?? null,
      lineage.runId ?? null,
      now,
    );
    return { visual: getVisualExplanation(db, visualMessageId, revision)!, created: true };
  })();
}

export function getVisualExplanation(db: Db, id: string, revision?: number | null): VisualMessage | null {
  const row = revision
    ? db.prepare("SELECT * FROM visual_message_revisions WHERE visual_message_id = ? AND revision = ?")
      .get(id, revision) as VisualMessageRow | undefined
    : getCurrentRow(db, id);
  if (row) return rowToVisual(row);

  const legacy = db.prepare("SELECT * FROM visual_explanations WHERE id = ?").get(id) as LegacyRow | undefined;
  if (!legacy) return null;
  if (revision && revision !== Math.max(1, legacy.version)) return null;
  return legacyToVisual(legacy);
}

export function listVisualExplanations(db: Db, limit = 40): VisualMessage[] {
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
  const current = db.prepare(`
    SELECT revisions.* FROM visual_message_revisions revisions
    JOIN (
      SELECT visual_message_id, MAX(revision) AS revision
      FROM visual_message_revisions GROUP BY visual_message_id
    ) latest
    ON latest.visual_message_id = revisions.visual_message_id
      AND latest.revision = revisions.revision
  `).all() as VisualMessageRow[];
  const currentIds = new Set(current.map((row) => row.visual_message_id));
  const legacy = (db.prepare("SELECT * FROM visual_explanations ORDER BY updated_at DESC, id ASC")
    .all() as LegacyRow[]).filter((row) => !currentIds.has(row.id));
  return [...current.map(rowToVisual), ...legacy.map(legacyToVisual)]
    .sort((a, b) => b.createdAt - a.createdAt || a.visualMessageId.localeCompare(b.visualMessageId))
    .slice(0, bounded);
}
