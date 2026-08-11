import { z } from "zod";
import { scrubSecrets } from "../security/scrub.js";

export const VISUAL_EXPLANATION_SCHEMA_VERSION = "1.0" as const;
export const STORYBOARD_SCHEMA_VERSION = "1.0" as const;
export const MAX_VISUAL_NODES = 80;
export const MAX_SCENE_NODES = 14;

export type VisualNodeShape = "process" | "decision" | "terminal";
export type VisualEdgeStyle = "flow" | "dotted" | "strong";

export type VisualTopologyNode = {
  id: string;
  label: string;
  shape: VisualNodeShape;
};

export type VisualTopologyEdge = {
  from: string;
  to: string;
  label: string | null;
  style: VisualEdgeStyle;
};

export type VisualTopology = {
  direction: "TD" | "TB" | "LR" | "RL" | "BT";
  nodes: VisualTopologyNode[];
  edges: VisualTopologyEdge[];
};

const StableId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/, "must be a stable ID (letter first; letters, numbers, _ or - only)");

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

export type VisualStoryboard = z.infer<typeof StoryboardSchema>;

export type CreateVisualExplanationInput = {
  title: string;
  summary: string;
  mermaid: string;
  storyboard: VisualStoryboard;
};

export class VisualExplanationValidationError extends Error {
  readonly name = "VisualExplanationValidationError";
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
  }
}

const FORBIDDEN_MERMAID = [
  { pattern: /%%\s*\{/i, label: "initialization directives" },
  { pattern: /^\s*(click|href|style|classDef|linkStyle)\b/im, label: "interactive or style directives" },
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
  if (!clean) throw new VisualExplanationValidationError(["Mermaid node and edge labels cannot be empty"]);
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

/**
 * Parse AVA's deliberately small Mermaid v1 grammar. Restricting canonical
 * topology to explicit node declarations and edges makes stable IDs verifiable
 * and removes Mermaid's link/callback/HTML attack surface before rendering.
 */
export function parseMermaidTopology(raw: string): { mermaid: string; topology: VisualTopology } {
  const mermaid = cleanText(raw, 30_000);
  if (!mermaid) throw new VisualExplanationValidationError(["Mermaid topology is required"]);
  for (const forbidden of FORBIDDEN_MERMAID) {
    if (forbidden.pattern.test(mermaid)) {
      throw new VisualExplanationValidationError([`Mermaid ${forbidden.label} are not allowed`]);
    }
  }
  const allLines = mermaid.split("\n");
  if (allLines.length > 400) throw new VisualExplanationValidationError(["Mermaid topology exceeds 400 lines"]);
  const lines = allLines.map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = lines.shift()?.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)$/);
  if (!header) {
    throw new VisualExplanationValidationError(["Mermaid v1 must start with flowchart TD, TB, LR, RL or BT"]);
  }

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
  return {
    mermaid,
    topology: {
      direction: header[1] as VisualTopology["direction"],
      nodes,
      edges,
    },
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

export function validateVisualExplanation(input: CreateVisualExplanationInput): {
  title: string;
  summary: string;
  mermaid: string;
  storyboard: VisualStoryboard;
  topology: VisualTopology;
} {
  const title = cleanText(String(input?.title ?? ""), 160);
  const summary = cleanText(String(input?.summary ?? ""), 1_000);
  const issues: string[] = [];
  if (!title) issues.push("title is required");
  if (!summary) issues.push("summary is required");
  const parsedStoryboard = StoryboardSchema.safeParse(input?.storyboard);
  if (!parsedStoryboard.success) {
    issues.push(...parsedStoryboard.error.issues.map((issue) => `storyboard.${issue.path.join(".") || "root"}: ${issue.message}`));
  }
  let parsedTopology: ReturnType<typeof parseMermaidTopology> | null = null;
  try { parsedTopology = parseMermaidTopology(String(input?.mermaid ?? "")); }
  catch (error) {
    if (error instanceof VisualExplanationValidationError) issues.push(...error.issues);
    else issues.push("Mermaid topology could not be parsed");
  }
  if (issues.length || !parsedStoryboard.success || !parsedTopology) {
    throw new VisualExplanationValidationError(issues.slice(0, 30));
  }

  const storyboard = sanitizeStoryboard(parsedStoryboard.data);
  const nodeIds = new Set(parsedTopology.topology.nodes.map((node) => node.id));
  const sceneIds = new Set<string>();
  const covered = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (sceneIds.has(scene.id)) issues.push(`duplicate storyboard scene ID: ${scene.id}`);
    sceneIds.add(scene.id);
    const sceneNodes = new Set<string>();
    for (const id of scene.nodeIds) {
      if (sceneNodes.has(id)) issues.push(`scene ${scene.id} repeats node ID ${id}`);
      sceneNodes.add(id);
      covered.add(id);
      if (!nodeIds.has(id)) issues.push(`scene ${scene.id} references unknown Mermaid node ID ${id}`);
    }
    for (const id of scene.highlightNodeIds) {
      if (!sceneNodes.has(id)) issues.push(`scene ${scene.id} highlights ${id} without including it`);
    }
  }
  if (!sceneIds.has(storyboard.startSceneId)) issues.push("startSceneId does not match a storyboard scene");
  for (const id of nodeIds) {
    if (!covered.has(id)) issues.push(`Mermaid node ${id} is not covered by any storyboard scene`);
  }
  if (parsedTopology.topology.nodes.length > MAX_SCENE_NODES && storyboard.scenes.length < 2) {
    issues.push("larger topologies require multiple scenes for progressive disclosure");
  }
  if (issues.length) throw new VisualExplanationValidationError(issues.slice(0, 30));

  return { title, summary, mermaid: parsedTopology.mermaid, storyboard, topology: parsedTopology.topology };
}

