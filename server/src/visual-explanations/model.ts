import { createHash } from "node:crypto";
import { z } from "zod";
import { scrubSecrets } from "../security/scrub.js";

export const VISUAL_MESSAGE_SCHEMA_VERSION = "1.0" as const;
/** Compatibility name for callers of the original visual_explanation API. */
export const VISUAL_EXPLANATION_SCHEMA_VERSION = VISUAL_MESSAGE_SCHEMA_VERSION;
export const STORYBOARD_SCHEMA_VERSION = "1.0" as const;
export const MAX_VISUAL_NODES = 80;
export const MAX_SCENE_NODES = 14;

export type VisualElementKind = "process" | "decision" | "terminal";
export type VisualRelationshipKind = "flow" | "dotted" | "strong";
export type VisualDiagramKind = "flowchart";

export type VisualSemanticElement = {
  id: string;
  label: string;
  kind: VisualElementKind;
};

export type VisualSemanticRelationship = {
  id: string;
  from: string;
  to: string;
  label: string | null;
  kind: VisualRelationshipKind;
};

export type VisualSemanticModel = {
  direction: "TD" | "TB" | "LR" | "RL" | "BT";
  elements: VisualSemanticElement[];
  relationships: VisualSemanticRelationship[];
};

// Compatibility projections used only while reading the original v1 table.
export type VisualTopologyNode = { id: string; label: string; shape: VisualElementKind };
export type VisualTopologyEdge = Omit<VisualSemanticRelationship, "id" | "kind"> & { style: VisualRelationshipKind };
export type VisualTopology = {
  direction: VisualSemanticModel["direction"];
  nodes: VisualTopologyNode[];
  edges: VisualTopologyEdge[];
};

const StableId = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_-]{1,63}$/,
  "must be a stable ID (letter first; letters, numbers, _ or - only)",
);

export const StoryboardSceneSchema = z.object({
  id: StableId,
  title: z.string().trim().min(1).max(100),
  caption: z.string().trim().min(1).max(600),
  nodeIds: z.array(StableId).min(1).max(MAX_SCENE_NODES),
  highlightNodeIds: z.array(StableId).max(8).default([]),
  transition: z.enum(["none", "fade", "slide"]).default("fade"),
  interactionCue: z.string().trim().min(1).max(200).optional(),
}).strict();

export const StoryboardSchema = z.object({
  schemaVersion: z.literal(STORYBOARD_SCHEMA_VERSION),
  startSceneId: StableId,
  scenes: z.array(StoryboardSceneSchema).min(1).max(20),
}).strict();

const SemanticModelSchema = z.object({
  direction: z.enum(["TD", "TB", "LR", "RL", "BT"]),
  elements: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["process", "decision", "terminal"]),
  }).strict()).min(2).max(MAX_VISUAL_NODES),
  relationships: z.array(z.object({
    id: StableId,
    from: StableId,
    to: StableId,
    label: z.string().trim().min(1).max(120).nullable().default(null),
    kind: z.enum(["flow", "dotted", "strong"]),
  }).strict()).min(1).max(160),
}).strict();

export type VisualStoryboard = z.infer<typeof StoryboardSchema>;

export type VisualRendererMetadata = {
  renderer: "mermaid";
  rendererSchemaVersion: "1.0";
  generatedFrom: "semantic_model";
  payload: string;
};

export type VisualAccessibleFallback = {
  heading: string;
  summary: string;
  elements: Array<{ id: string; label: string; kind: VisualElementKind }>;
  relationships: Array<{ id: string; text: string }>;
  scenes: Array<{ id: string; title: string; caption: string }>;
};

export type VisualMessage = {
  schemaVersion: typeof VISUAL_MESSAGE_SCHEMA_VERSION;
  visualMessageId: string;
  revision: number;
  diagramKind: VisualDiagramKind;
  title: string;
  summary: string;
  semanticModel: VisualSemanticModel;
  storyboard: VisualStoryboard;
  renderer: VisualRendererMetadata;
  accessibleFallback: VisualAccessibleFallback;
  source: "manual" | "ava_chat" | "ava_voice";
  sourceSessionId: string | null;
  sourceRunId: string | null;
  createdAt: number;
};

export type CreateVisualExplanationInput = {
  title: string;
  summary: string;
  diagramKind?: VisualDiagramKind;
  /** Preferred renderer-neutral authoring contract. */
  semanticModel?: VisualSemanticModel;
  /** Backward-compatible ingest format for the established tool. */
  mermaid?: string;
  storyboard: VisualStoryboard;
  revisesVisualMessageId?: string;
  expectedRevision?: number;
};

export class VisualExplanationValidationError extends Error {
  readonly name = "VisualExplanationValidationError";
  constructor(readonly issues: string[]) { super(issues.join("; ")); }
}

export class StaleVisualRevisionError extends Error {
  readonly name = "StaleVisualRevisionError";
  constructor(readonly currentRevision: number) {
    super(`visual revision is stale; current revision is ${currentRevision}`);
  }
}

const FORBIDDEN_MERMAID = [
  { pattern: /%%\s*\{/i, label: "initialization directives" },
  { pattern: /^\s*(click|href|style|classDef|class|linkStyle)\b/im, label: "interactive or style directives" },
  { pattern: /javascript\s*:/i, label: "javascript URLs" },
  { pattern: /data\s*:/i, label: "data URLs" },
  { pattern: /url\s*\(/i, label: "external CSS URLs" },
  { pattern: /<\/?[a-z][^>]*>/i, label: "HTML markup" },
] as const;

function cleanText(value: string, max: number): string {
  return scrubSecrets(value).trim().replace(/\r\n/g, "\n").slice(0, max);
}

function cleanLabel(value: string): string {
  const clean = cleanText(value, 120).replace(/\s+/g, " ");
  if (!clean) throw new VisualExplanationValidationError(["Visual labels cannot be empty"]);
  return clean;
}

function parseNode(line: string): VisualTopologyNode | null {
  const terminal = line.match(/^([A-Za-z][A-Za-z0-9_-]{1,63})\(\["([^"\r\n]{1,120})"\]\)$/);
  if (terminal) return { id: terminal[1]!, label: cleanLabel(terminal[2]!), shape: "terminal" };
  const decision = line.match(/^([A-Za-z][A-Za-z0-9_-]{1,63})\{"([^"\r\n]{1,120})"\}$/);
  if (decision) return { id: decision[1]!, label: cleanLabel(decision[2]!), shape: "decision" };
  const process = line.match(/^([A-Za-z][A-Za-z0-9_-]{1,63})\["([^"\r\n]{1,120})"\]$/);
  if (process) return { id: process[1]!, label: cleanLabel(process[2]!), shape: "process" };
  return null;
}

function parseEdge(line: string): VisualTopologyEdge | null {
  const match = line.match(/^([A-Za-z][A-Za-z0-9_-]{1,63})\s+(-->|-\.->|==>)\s*(?:\|([^|\r\n]{1,120})\|\s*)?([A-Za-z][A-Za-z0-9_-]{1,63})$/);
  if (!match) return null;
  return {
    from: match[1]!,
    to: match[4]!,
    label: match[3] ? cleanLabel(match[3]) : null,
    style: match[2] === "-.->" ? "dotted" : match[2] === "==>" ? "strong" : "flow",
  };
}

/** Parse the deliberately small legacy Mermaid ingest grammar. */
export function parseMermaidTopology(raw: string): { mermaid: string; topology: VisualTopology } {
  const mermaid = cleanText(raw, 30_000);
  if (!mermaid) throw new VisualExplanationValidationError(["Mermaid or semanticModel is required"]);
  for (const forbidden of FORBIDDEN_MERMAID) {
    if (forbidden.pattern.test(mermaid)) {
      throw new VisualExplanationValidationError([`Mermaid ${forbidden.label} are not allowed`]);
    }
  }
  const allLines = mermaid.split("\n");
  if (allLines.length > 400) throw new VisualExplanationValidationError(["Mermaid topology exceeds 400 lines"]);
  const lines = allLines.map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = lines.shift()?.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)$/);
  if (!header) throw new VisualExplanationValidationError(["Mermaid v1 must start with flowchart TD, TB, LR, RL or BT"]);

  const nodes: VisualTopologyNode[] = [];
  const edges: VisualTopologyEdge[] = [];
  const ids = new Set<string>();
  const invalid: string[] = [];
  for (const line of lines) {
    const node = parseNode(line);
    if (node) {
      if (ids.has(node.id)) invalid.push(`duplicate Mermaid node ID: ${node.id}`);
      else { ids.add(node.id); nodes.push(node); }
      continue;
    }
    const edge = parseEdge(line);
    if (edge) { edges.push(edge); continue; }
    invalid.push(`unsupported Mermaid statement: ${line.slice(0, 100)}`);
  }
  if (nodes.length < 2) invalid.push("Mermaid topology needs at least two explicitly declared nodes");
  if (nodes.length > MAX_VISUAL_NODES) invalid.push(`Mermaid topology exceeds ${MAX_VISUAL_NODES} nodes`);
  if (edges.length < 1) invalid.push("Mermaid topology needs at least one edge");
  for (const edge of edges) {
    if (!ids.has(edge.from)) invalid.push(`edge references undeclared node: ${edge.from}`);
    if (!ids.has(edge.to)) invalid.push(`edge references undeclared node: ${edge.to}`);
  }
  if (invalid.length) throw new VisualExplanationValidationError(invalid.slice(0, 20));
  return { mermaid, topology: { direction: header[1] as VisualTopology["direction"], nodes, edges } };
}

function relationshipId(edge: VisualTopologyEdge, occurrence: number): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([edge.from, edge.to, edge.label, edge.style, occurrence]))
    .digest("hex").slice(0, 12);
  return `rel_${digest}`;
}

export function topologyToSemanticModel(topology: VisualTopology): VisualSemanticModel {
  const seen = new Map<string, number>();
  return {
    direction: topology.direction,
    elements: topology.nodes.map((node) => ({ id: node.id, label: node.label, kind: node.shape })),
    relationships: topology.edges.map((edge) => {
      const key = JSON.stringify([edge.from, edge.to, edge.label, edge.style]);
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      return { id: relationshipId(edge, occurrence), from: edge.from, to: edge.to, label: edge.label, kind: edge.style };
    }),
  };
}

export function semanticModelToTopology(model: VisualSemanticModel): VisualTopology {
  return {
    direction: model.direction,
    nodes: model.elements.map((element) => ({ id: element.id, label: element.label, shape: element.kind })),
    edges: model.relationships.map((relationship) => ({
      from: relationship.from,
      to: relationship.to,
      label: relationship.label,
      style: relationship.kind,
    })),
  };
}

function quoteLabel(label: string): string {
  return label.replace(/["\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export function semanticModelToMermaid(model: VisualSemanticModel): string {
  const lines = [`flowchart ${model.direction}`];
  for (const element of model.elements) {
    const label = quoteLabel(element.label);
    if (element.kind === "decision") lines.push(`${element.id}{"${label}"}`);
    else if (element.kind === "terminal") lines.push(`${element.id}(["${label}"])`);
    else lines.push(`${element.id}["${label}"]`);
  }
  for (const relationship of model.relationships) {
    const operator = relationship.kind === "dotted" ? "-.->" : relationship.kind === "strong" ? "==>" : "-->";
    lines.push(`${relationship.from} ${operator}${relationship.label ? `|${quoteLabel(relationship.label)}| ` : " "}${relationship.to}`);
  }
  return lines.join("\n");
}

function sanitizeSemanticModel(model: VisualSemanticModel): VisualSemanticModel {
  return {
    direction: model.direction,
    elements: model.elements.map((element) => ({ ...element, label: cleanLabel(element.label) })),
    relationships: model.relationships.map((relationship) => ({
      ...relationship,
      label: relationship.label ? cleanLabel(relationship.label) : null,
    })),
  };
}

function sanitizeStoryboard(storyboard: VisualStoryboard): VisualStoryboard {
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    startSceneId: storyboard.startSceneId,
    scenes: storyboard.scenes.map((scene) => ({
      id: scene.id,
      title: cleanText(scene.title, 100),
      caption: cleanText(scene.caption, 600),
      nodeIds: [...scene.nodeIds],
      highlightNodeIds: [...scene.highlightNodeIds],
      transition: scene.transition,
      ...(scene.interactionCue ? { interactionCue: cleanText(scene.interactionCue, 200) } : {}),
    })),
  };
}

export function buildAccessibleFallback(
  title: string,
  summary: string,
  model: VisualSemanticModel,
  storyboard: VisualStoryboard,
): VisualAccessibleFallback {
  const labels = new Map(model.elements.map((element) => [element.id, element.label]));
  return {
    heading: title,
    summary,
    elements: model.elements.map((element) => ({ ...element })),
    relationships: model.relationships.map((relationship) => ({
      id: relationship.id,
      text: `${labels.get(relationship.from) ?? relationship.from}${relationship.label ? ` — ${relationship.label} —` : " leads to"} ${labels.get(relationship.to) ?? relationship.to}`,
    })),
    scenes: storyboard.scenes.map((scene) => ({ id: scene.id, title: scene.title, caption: scene.caption })),
  };
}

export function validateVisualExplanation(input: CreateVisualExplanationInput): {
  title: string;
  summary: string;
  diagramKind: VisualDiagramKind;
  semanticModel: VisualSemanticModel;
  storyboard: VisualStoryboard;
  renderer: VisualRendererMetadata;
  accessibleFallback: VisualAccessibleFallback;
  revisesVisualMessageId: string | null;
  expectedRevision: number | null;
} {
  const title = cleanText(String(input?.title ?? ""), 160);
  const summary = cleanText(String(input?.summary ?? ""), 1_000);
  const issues: string[] = [];
  if (!title) issues.push("title is required");
  if (!summary) issues.push("summary is required");
  if (input.diagramKind && input.diagramKind !== "flowchart") issues.push("diagramKind must be flowchart in v1");

  const parsedStoryboard = StoryboardSchema.safeParse(input?.storyboard);
  if (!parsedStoryboard.success) {
    issues.push(...parsedStoryboard.error.issues.map((issue) => `storyboard.${issue.path.join(".") || "root"}: ${issue.message}`));
  }

  let semanticModel: VisualSemanticModel | null = null;
  if (input.semanticModel) {
    const parsed = SemanticModelSchema.safeParse(input.semanticModel);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `semanticModel.${issue.path.join(".") || "root"}: ${issue.message}`));
    } else semanticModel = sanitizeSemanticModel(parsed.data);
  } else {
    try { semanticModel = topologyToSemanticModel(parseMermaidTopology(String(input?.mermaid ?? "")).topology); }
    catch (error) {
      if (error instanceof VisualExplanationValidationError) issues.push(...error.issues);
      else issues.push("Mermaid topology could not be parsed");
    }
  }

  const revisesVisualMessageId = input.revisesVisualMessageId ?? null;
  const expectedRevision = input.expectedRevision ?? null;
  if (revisesVisualMessageId && !/^visual_[A-Za-z0-9_-]{8,32}$/.test(revisesVisualMessageId)) {
    issues.push("revisesVisualMessageId is invalid");
  }
  if ((revisesVisualMessageId === null) !== (expectedRevision === null)) {
    issues.push("revisesVisualMessageId and expectedRevision must be supplied together");
  }
  if (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    issues.push("expectedRevision must be a positive integer");
  }

  if (issues.length || !parsedStoryboard.success || !semanticModel) {
    throw new VisualExplanationValidationError(issues.slice(0, 30));
  }

  const storyboard = sanitizeStoryboard(parsedStoryboard.data);
  const elementIds = new Set<string>();
  const relationshipIds = new Set<string>();
  for (const element of semanticModel.elements) {
    if (elementIds.has(element.id)) issues.push(`duplicate semantic element ID: ${element.id}`);
    elementIds.add(element.id);
  }
  for (const relationship of semanticModel.relationships) {
    if (relationshipIds.has(relationship.id)) issues.push(`duplicate semantic relationship ID: ${relationship.id}`);
    relationshipIds.add(relationship.id);
    if (!elementIds.has(relationship.from)) issues.push(`relationship ${relationship.id} references unknown source ${relationship.from}`);
    if (!elementIds.has(relationship.to)) issues.push(`relationship ${relationship.id} references unknown target ${relationship.to}`);
  }

  const sceneIds = new Set<string>();
  const covered = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (sceneIds.has(scene.id)) issues.push(`duplicate storyboard scene ID: ${scene.id}`);
    sceneIds.add(scene.id);
    const sceneNodes = new Set<string>();
    for (const id of scene.nodeIds) {
      if (sceneNodes.has(id)) issues.push(`scene ${scene.id} repeats element ID ${id}`);
      sceneNodes.add(id);
      covered.add(id);
      if (!elementIds.has(id)) issues.push(`scene ${scene.id} references unknown semantic element ID ${id}`);
    }
    for (const id of scene.highlightNodeIds) {
      if (!sceneNodes.has(id)) issues.push(`scene ${scene.id} highlights ${id} without including it`);
    }
  }
  if (!sceneIds.has(storyboard.startSceneId)) issues.push("startSceneId does not match a storyboard scene");
  for (const id of elementIds) if (!covered.has(id)) issues.push(`semantic element ${id} is not covered by any storyboard scene`);
  if (semanticModel.elements.length > MAX_SCENE_NODES && storyboard.scenes.length < 2) {
    issues.push("larger models require multiple scenes for progressive disclosure");
  }
  if (issues.length) throw new VisualExplanationValidationError(issues.slice(0, 30));

  const payload = semanticModelToMermaid(semanticModel);
  // The derived payload must pass the same restricted grammar used for legacy
  // input. This is a security assertion, not a second canonical source.
  parseMermaidTopology(payload);
  return {
    title,
    summary,
    diagramKind: "flowchart",
    semanticModel,
    storyboard,
    renderer: {
      renderer: "mermaid",
      rendererSchemaVersion: "1.0",
      generatedFrom: "semantic_model",
      payload,
    },
    accessibleFallback: buildAccessibleFallback(title, summary, semanticModel, storyboard),
    revisesVisualMessageId,
    expectedRevision,
  };
}
