export type VisualElementKind = "process" | "decision" | "terminal";
export type VisualRelationshipKind = "flow" | "dotted" | "strong";

export type VisualSemanticModel = {
  direction: "TD" | "TB" | "LR" | "RL" | "BT";
  elements: Array<{ id: string; label: string; kind: VisualElementKind }>;
  relationships: Array<{
    id: string;
    from: string;
    to: string;
    label: string | null;
    kind: VisualRelationshipKind;
  }>;
};

export type VisualScene = {
  id: string;
  title: string;
  caption: string;
  nodeIds: string[];
  highlightNodeIds: string[];
  transition: "none" | "fade" | "slide";
  interactionCue?: string;
};

export type VisualMessage = {
  schemaVersion: "1.0";
  visualMessageId: string;
  revision: number;
  diagramKind: "flowchart";
  title: string;
  summary: string;
  semanticModel: VisualSemanticModel;
  storyboard: { schemaVersion: "1.0"; startSceneId: string; scenes: VisualScene[] };
  renderer: {
    renderer: "react-flow" | "mermaid";
    rendererSchemaVersion: "1.0";
    generatedFrom: "semantic_model";
    payload: string;
  };
  accessibleFallback: {
    heading: string;
    summary: string;
    elements: Array<{ id: string; label: string; kind: VisualElementKind }>;
    relationships: Array<{ id: string; text: string }>;
    scenes: Array<{ id: string; title: string; caption: string }>;
  };
  source: "manual" | "ava_chat" | "ava_voice";
  sourceSessionId: string | null;
  sourceRunId: string | null;
  createdAt: number;
};

export type VisualMessageReference = {
  visualMessageId: string;
  revision: number;
};

export type VisualSemanticAction = "explain" | "branch" | "attach";

export type VisualMessageContext = VisualMessageReference & {
  action: VisualSemanticAction;
  sceneId: string;
  selectedElementIds: string[];
};

const STABLE_ID = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const VISUAL_ID = /^visual_[A-Za-z0-9_-]{8,32}$/;
const DIRECTIONS = new Set(["TD", "TB", "LR", "RL", "BT"]);
const ELEMENT_KINDS = new Set(["process", "decision", "terminal"]);
const RELATIONSHIP_KINDS = new Set(["flow", "dotted", "strong"]);
const TRANSITIONS = new Set(["none", "fade", "slide"]);
const SOURCES = new Set(["manual", "ava_chat", "ava_voice"]);
const RENDERERS = new Set(["react-flow", "mermaid"]);

function hasValidRendererPayload(renderer: VisualMessage["renderer"]): boolean {
  if (renderer.renderer === "mermaid") return true; // Legacy source is never executed by the current renderer.
  try {
    const value = JSON.parse(renderer.payload) as Record<string, unknown>;
    return value !== null && !Array.isArray(value) &&
      value.layout === "dagre" && value.interaction === "read_only" &&
      Object.keys(value).every((key) => key === "layout" || key === "interaction");
  } catch {
    return false;
  }
}

/** Defensive client gate for API, cache and message-history payloads. */
export function isVisualMessage(value: unknown): value is VisualMessage {
  if (!value || typeof value !== "object") return false;
  const visual = value as Partial<VisualMessage>;
  if (
    visual.schemaVersion !== "1.0" ||
    typeof visual.visualMessageId !== "string" || !VISUAL_ID.test(visual.visualMessageId) ||
    !Number.isInteger(visual.revision) || (visual.revision ?? 0) < 1 ||
    visual.diagramKind !== "flowchart" ||
    typeof visual.title !== "string" || !visual.title.trim() || visual.title.length > 160 ||
    typeof visual.summary !== "string" || !visual.summary.trim() || visual.summary.length > 1_200 ||
    !visual.semanticModel || !Array.isArray(visual.semanticModel.elements) ||
    !Array.isArray(visual.semanticModel.relationships) ||
    !DIRECTIONS.has(visual.semanticModel.direction) ||
    !visual.storyboard || visual.storyboard.schemaVersion !== "1.0" || !Array.isArray(visual.storyboard.scenes) ||
    !visual.renderer || !RENDERERS.has(visual.renderer.renderer ?? "") ||
    visual.renderer.rendererSchemaVersion !== "1.0" ||
    visual.renderer.generatedFrom !== "semantic_model" ||
    typeof visual.renderer.payload !== "string" || visual.renderer.payload.length > 40_000 ||
    !visual.accessibleFallback ||
    typeof visual.accessibleFallback.heading !== "string" ||
    typeof visual.accessibleFallback.summary !== "string" ||
    !Array.isArray(visual.accessibleFallback.elements) ||
    !Array.isArray(visual.accessibleFallback.relationships) ||
    !Array.isArray(visual.accessibleFallback.scenes) ||
    !SOURCES.has(visual.source ?? "") ||
    !Number.isSafeInteger(visual.createdAt) || (visual.createdAt ?? 0) < 0
  ) return false;
  if (!hasValidRendererPayload(visual.renderer)) return false;
  const ids = new Set<string>();
  for (const element of visual.semanticModel.elements) {
    if (!STABLE_ID.test(element.id) || ids.has(element.id) || typeof element.label !== "string" ||
        !element.label.trim() || element.label.length > 240 || !ELEMENT_KINDS.has(element.kind)) return false;
    ids.add(element.id);
  }
  if (ids.size < 2 || ids.size > 80) return false;
  const relationshipIds = new Set<string>();
  for (const relationship of visual.semanticModel.relationships) {
    if (!STABLE_ID.test(relationship.id) || relationshipIds.has(relationship.id)) return false;
    if (!ids.has(relationship.from) || !ids.has(relationship.to)) return false;
    if (!RELATIONSHIP_KINDS.has(relationship.kind) ||
        !(relationship.label === null || (typeof relationship.label === "string" && relationship.label.length <= 160))) return false;
    relationshipIds.add(relationship.id);
  }
  const sceneIds = new Set<string>();
  if (visual.storyboard.scenes.length < 1 || visual.storyboard.scenes.length > 16) return false;
  for (const scene of visual.storyboard.scenes) {
    if (!STABLE_ID.test(scene.id) || sceneIds.has(scene.id) || typeof scene.title !== "string" ||
        typeof scene.caption !== "string" || !Array.isArray(scene.nodeIds) || !Array.isArray(scene.highlightNodeIds) ||
        scene.nodeIds.length < 1 || new Set(scene.nodeIds).size !== scene.nodeIds.length ||
        scene.nodeIds.some((id) => !ids.has(id)) || !TRANSITIONS.has(scene.transition)) return false;
    if (scene.highlightNodeIds.some((id) => !scene.nodeIds.includes(id))) return false;
    sceneIds.add(scene.id);
  }
  return sceneIds.has(visual.storyboard.startSceneId);
}
