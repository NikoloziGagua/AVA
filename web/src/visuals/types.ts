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

export type FlowVisualMessage = {
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

export type ResearchVisualForm = "geographic_map" | "timeline" | "evidence_matrix" | "claim_evidence_graph" | "chart" | "process";
export type ResearchEvidenceConfidence = "high" | "medium" | "low" | "unknown";
export type ResearchEvidenceStatus = "supported" | "disputed" | "counterevidence" | "gap" | "context";
export type ResearchEvidenceRefs = {
  claimIds: string[];
  sourceIds: string[];
  confidence: ResearchEvidenceConfidence;
  evidenceStatus: ResearchEvidenceStatus;
  uncertainty: string | null;
};
export type ResearchSource = {
  id: string; title: string; url: string; publisher: string | null; publishedAt: string | null;
  quality: "primary" | "scholarly" | "official" | "reputable_secondary" | "other" | "unknown";
  qualityNote: string | null;
};
export type ResearchClaim = {
  id: string; text: string; confidence: ResearchEvidenceConfidence;
  status: "supported" | "disputed" | "uncertain" | "missing_evidence";
  sourceIds: string[]; counterSourceIds: string[]; limitation: string | null;
};
export type ResearchScene = {
  id: string; title: string; caption: string; entityIds: string[]; highlightEntityIds: string[];
  sourceIds: string[]; transition: "none" | "fade" | "slide"; interactionCue?: string;
};

type EvidenceEntity = ResearchEvidenceRefs & { id: string; label: string };
export type GeographicMapModel = {
  kind: "geographic_map"; projection: "natural-earth-1";
  locations: Array<EvidenceEntity & { description: string; longitude: number; latitude: number; coordinatePrecision: "exact" | "approximate" | "regional"; uncertaintyKm: number | null; coordinateSourceId: string; periodStart: string | null; periodEnd: string | null }>;
  routes: Array<EvidenceEntity & { from: string; to: string; direction: "forward" | "bidirectional" | "unknown"; periodStart: string | null; periodEnd: string | null }>;
  regions: Array<EvidenceEntity & { bounds: [number, number, number, number]; periodStart: string | null; periodEnd: string | null }>;
  timeLayers: Array<{ id: string; label: string; period: string; entityIds: string[] }>;
  legend: Array<{ id: string; label: string; meaning: string }>;
};
export type TimelineModel = { kind: "timeline"; events: Array<EvidenceEntity & { description: string; dateLabel: string; startYear: number | null; endYear: number | null; datePrecision: "exact" | "year" | "range" | "approximate" | "unknown" }>; links: Array<{ id: string; from: string; to: string; label: string; kind: "precedes" | "causes" | "influences" | "overlaps" | "disputed" }> };
export type EvidenceMatrixModel = { kind: "evidence_matrix"; rows: Array<{ id: string; label: string }>; columns: Array<{ id: string; label: string }>; cells: Array<EvidenceEntity & { rowId: string; columnId: string; coverage: "strong" | "moderate" | "weak" | "missing" | "disputed"; detail: string }> };
export type ClaimEvidenceGraphModel = { kind: "claim_evidence_graph"; direction: "TD" | "LR"; nodes: Array<EvidenceEntity & { nodeKind: "claim" | "source" | "counterevidence" | "objection" | "disputed_point" | "evidence_gap"; description: string }>; relationships: Array<{ id: string; from: string; to: string; label: string; kind: "supports" | "contradicts" | "qualifies" | "objects_to" | "leaves_open" }> };
export type ChartModel = { kind: "chart"; chartType: "bar" | "line" | "range"; xLabel: string; yLabel: string; unit: string; series: Array<{ id: string; label: string; colorHint: "cyan" | "purple" | "amber" | "green" | "red" | "grey" }>; points: Array<EvidenceEntity & { seriesId: string; x: string | number; value: number | null; low: number | null; high: number | null }>; zeroBaseline: boolean };
export type ResearchProcessModel = { kind: "process"; direction: "TD" | "TB" | "LR" | "RL" | "BT"; elements: Array<EvidenceEntity & { elementKind: VisualElementKind; description: string }>; relationships: Array<{ id: string; from: string; to: string; label: string | null; kind: VisualRelationshipKind }> };
export type ResearchSemanticModel = GeographicMapModel | TimelineModel | EvidenceMatrixModel | ClaimEvidenceGraphModel | ChartModel | ResearchProcessModel;

export type ResearchVisualMessage = {
  schemaVersion: "2.0"; visualMessageId: string; revision: number; diagramKind: ResearchVisualForm;
  title: string; summary: string; question: string;
  selection: { recommendedForm: ResearchVisualForm; selectedForm: ResearchVisualForm; reason: string; userSelected: boolean };
  synthesis: string; methodology: string; limitations: string[]; sources: ResearchSource[]; claims: ResearchClaim[];
  semanticModel: ResearchSemanticModel;
  storyboard: { schemaVersion: "2.0"; startSceneId: string; scenes: ResearchScene[] };
  renderer: { renderer: "d3-geo" | "native-svg" | "react-flow"; rendererSchemaVersion: "2.0"; generatedFrom: "semantic_model"; payload: string };
  accessibleFallback: { heading: string; summary: string; sections: Array<{ title: string; text: string }>; entities: Array<{ id: string; label: string; detail: string }>; sources: Array<{ id: string; title: string; url: string }>; scenes: Array<{ id: string; title: string; caption: string }> };
  source: "manual" | "ava_chat" | "ava_voice"; sourceSessionId: string | null; sourceRunId: string | null; createdAt: number;
};

export type VisualMessage = FlowVisualMessage | ResearchVisualMessage;

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

function hasValidRendererPayload(renderer: FlowVisualMessage["renderer"]): boolean {
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
function isFlowVisualMessage(value: unknown): value is FlowVisualMessage {
  if (!value || typeof value !== "object") return false;
  const visual = value as Partial<FlowVisualMessage>;
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

const RESEARCH_FORMS = new Set<ResearchVisualForm>(["geographic_map", "timeline", "evidence_matrix", "claim_evidence_graph", "chart", "process"]);
const RESEARCH_RENDERERS = new Set(["d3-geo", "native-svg", "react-flow"]);
const CONFIDENCE = new Set(["high", "medium", "low", "unknown"]);
const EVIDENCE_STATUS = new Set(["supported", "disputed", "counterevidence", "gap", "context"]);

function safeHttpUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > 2_000) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password &&
      [...url.searchParams.keys()].every((key) => !/token|secret|auth|signature|sig|key|password|session/i.test(key));
  }
  catch { return false; }
}

export function researchEntityIds(model: ResearchSemanticModel): string[] {
  if (model.kind === "geographic_map") return [...model.locations, ...model.routes, ...model.regions].map((item) => item.id);
  if (model.kind === "timeline") return model.events.map((item) => item.id);
  if (model.kind === "evidence_matrix") return model.cells.map((item) => item.id);
  if (model.kind === "claim_evidence_graph") return model.nodes.map((item) => item.id);
  if (model.kind === "chart") return model.points.map((item) => item.id);
  return model.elements.map((item) => item.id);
}

export function researchEntityLabel(model: ResearchSemanticModel, id: string): string {
  const collection = model.kind === "geographic_map" ? [...model.locations, ...model.routes, ...model.regions]
    : model.kind === "timeline" ? model.events
    : model.kind === "evidence_matrix" ? model.cells
    : model.kind === "claim_evidence_graph" ? model.nodes
    : model.kind === "chart" ? model.points
    : model.elements;
  return collection.find((item) => item.id === id)?.label ?? id;
}

function isEvidenceEntity(value: any): boolean {
  return value && STABLE_ID.test(value.id) && typeof value.label === "string" && value.label.length <= 180 &&
    Array.isArray(value.claimIds) && Array.isArray(value.sourceIds) && CONFIDENCE.has(value.confidence) &&
    EVIDENCE_STATUS.has(value.evidenceStatus) && (value.uncertainty === null || typeof value.uncertainty === "string");
}

function isResearchVisualMessage(value: unknown): value is ResearchVisualMessage {
  if (!value || typeof value !== "object") return false;
  const visual = value as any;
  if (visual.schemaVersion !== "2.0" || !VISUAL_ID.test(visual.visualMessageId) || !Number.isInteger(visual.revision) || visual.revision < 1 ||
      !RESEARCH_FORMS.has(visual.diagramKind) || typeof visual.title !== "string" || typeof visual.summary !== "string" || typeof visual.question !== "string" ||
      !visual.selection || !RESEARCH_FORMS.has(visual.selection.recommendedForm) || visual.selection.selectedForm !== visual.diagramKind ||
      !Array.isArray(visual.sources) || visual.sources.length < 1 || visual.sources.length > 80 || !Array.isArray(visual.claims) || visual.claims.length < 1 || visual.claims.length > 100 ||
      !visual.semanticModel || visual.semanticModel.kind !== visual.diagramKind || !visual.storyboard || visual.storyboard.schemaVersion !== "2.0" ||
      !visual.renderer || !RESEARCH_RENDERERS.has(visual.renderer.renderer) || visual.renderer.rendererSchemaVersion !== "2.0" ||
      typeof visual.renderer.payload !== "string" || visual.renderer.payload.length > 40_000 || !visual.accessibleFallback ||
      !SOURCES.has(visual.source) || !Number.isSafeInteger(visual.createdAt)) return false;
  if (!Array.isArray(visual.accessibleFallback.sections) || !Array.isArray(visual.accessibleFallback.entities) ||
      !Array.isArray(visual.accessibleFallback.sources) || !Array.isArray(visual.accessibleFallback.scenes) ||
      !visual.accessibleFallback.sources.every((source: any) => STABLE_ID.test(source.id) && typeof source.title === "string" && safeHttpUrl(source.url))) return false;
  const expectedRenderer = visual.diagramKind === "geographic_map" ? "d3-geo"
    : visual.diagramKind === "claim_evidence_graph" || visual.diagramKind === "process" ? "react-flow" : "native-svg";
  if (visual.renderer.renderer !== expectedRenderer || visual.renderer.generatedFrom !== "semantic_model") return false;
  const sourceIds = new Set<string>();
  for (const source of visual.sources) {
    if (!STABLE_ID.test(source.id) || sourceIds.has(source.id) || typeof source.title !== "string" || !safeHttpUrl(source.url)) return false;
    sourceIds.add(source.id);
  }
  const claimIds = new Set<string>();
  for (const claim of visual.claims) {
    if (!STABLE_ID.test(claim.id) || claimIds.has(claim.id) || typeof claim.text !== "string" || !CONFIDENCE.has(claim.confidence) ||
        !Array.isArray(claim.sourceIds) || !Array.isArray(claim.counterSourceIds) || [...claim.sourceIds, ...claim.counterSourceIds].some((id) => !sourceIds.has(id))) return false;
    claimIds.add(claim.id);
  }
  const ids = researchEntityIds(visual.semanticModel);
  if (ids.length < 1 || ids.length > 240 || new Set(ids).size !== ids.length) return false;
  const entities = visual.semanticModel.kind === "geographic_map" ? [...visual.semanticModel.locations, ...visual.semanticModel.routes, ...visual.semanticModel.regions]
    : visual.semanticModel.kind === "timeline" ? visual.semanticModel.events
    : visual.semanticModel.kind === "evidence_matrix" ? visual.semanticModel.cells
    : visual.semanticModel.kind === "claim_evidence_graph" ? visual.semanticModel.nodes
    : visual.semanticModel.kind === "chart" ? visual.semanticModel.points
    : visual.semanticModel.elements;
  if (!entities.every((entity: any) => isEvidenceEntity(entity) && entity.claimIds.every((id: string) => claimIds.has(id)) && entity.sourceIds.every((id: string) => sourceIds.has(id)))) return false;
  const entityIdSet = new Set(ids);
  if (visual.semanticModel.kind === "geographic_map") {
    const locationIds = new Set(visual.semanticModel.locations.map((item: any) => item.id));
    if (!visual.semanticModel.locations.every((item: any) => Number.isFinite(item.longitude) && item.longitude >= -180 && item.longitude <= 180 && Number.isFinite(item.latitude) && item.latitude >= -90 && item.latitude <= 90 && sourceIds.has(item.coordinateSourceId) && item.sourceIds.includes(item.coordinateSourceId))) return false;
    if (!visual.semanticModel.routes.every((item: any) => locationIds.has(item.from) && locationIds.has(item.to))) return false;
    if (!visual.semanticModel.regions.every((item: any) => Array.isArray(item.bounds) && item.bounds.length === 4 && item.bounds.every(Number.isFinite) && item.bounds[0] <= item.bounds[2] && item.bounds[1] <= item.bounds[3])) return false;
    if (!Array.isArray(visual.semanticModel.timeLayers) || !visual.semanticModel.timeLayers.length || !visual.semanticModel.timeLayers.every((item: any) => STABLE_ID.test(item.id) && Array.isArray(item.entityIds) && item.entityIds.length && item.entityIds.every((id: string) => entityIdSet.has(id)))) return false;
  } else if (visual.semanticModel.kind === "timeline") {
    if (!visual.semanticModel.links.every((item: any) => STABLE_ID.test(item.id) && entityIdSet.has(item.from) && entityIdSet.has(item.to))) return false;
  } else if (visual.semanticModel.kind === "evidence_matrix") {
    const rowIds = new Set(visual.semanticModel.rows.map((item: any) => item.id));
    const columnIds = new Set(visual.semanticModel.columns.map((item: any) => item.id));
    if (rowIds.size !== visual.semanticModel.rows.length || columnIds.size !== visual.semanticModel.columns.length ||
        !visual.semanticModel.cells.every((item: any) => rowIds.has(item.rowId) && columnIds.has(item.columnId))) return false;
  } else if (visual.semanticModel.kind === "claim_evidence_graph" || visual.semanticModel.kind === "process") {
    if (!visual.semanticModel.relationships.every((item: any) => STABLE_ID.test(item.id) && entityIdSet.has(item.from) && entityIdSet.has(item.to))) return false;
  } else if (visual.semanticModel.kind === "chart") {
    const seriesIds = new Set(visual.semanticModel.series.map((item: any) => item.id));
    if (seriesIds.size !== visual.semanticModel.series.length || !visual.semanticModel.points.every((item: any) => seriesIds.has(item.seriesId) &&
        (item.value === null || Number.isFinite(item.value)) && (item.low === null || Number.isFinite(item.low)) &&
        (item.high === null || Number.isFinite(item.high)) && !(item.low !== null && item.high !== null && item.low > item.high))) return false;
  }
  if (!Array.isArray(visual.storyboard.scenes) || visual.storyboard.scenes.length < 1 || visual.storyboard.scenes.length > 24) return false;
  const scenes = new Set<string>();
  const covered = new Set<string>();
  for (const scene of visual.storyboard.scenes) {
    if (!STABLE_ID.test(scene.id) || scenes.has(scene.id) || !Array.isArray(scene.entityIds) || scene.entityIds.length < 1 || scene.entityIds.length > 14 ||
        new Set(scene.entityIds).size !== scene.entityIds.length || scene.entityIds.some((id: string) => !entityIdSet.has(id)) ||
        !Array.isArray(scene.highlightEntityIds) || scene.highlightEntityIds.length > 8 || scene.highlightEntityIds.some((id: string) => !scene.entityIds.includes(id)) ||
        !Array.isArray(scene.sourceIds) ||
        scene.sourceIds.some((id: string) => !sourceIds.has(id))) return false;
    scene.entityIds.forEach((id: string) => covered.add(id));
    scenes.add(scene.id);
  }
  if (covered.size !== entityIdSet.size) return false;
  try {
    const payload = JSON.parse(visual.renderer.payload);
    if (!payload || Array.isArray(payload) || payload.renderer !== visual.renderer.renderer || payload.mode !== "read_only" || payload.provenance !== "claim_level" ||
        !Object.keys(payload).every((key) => key === "renderer" || key === "mode" || key === "provenance")) return false;
  } catch { return false; }
  return scenes.has(visual.storyboard.startSceneId);
}

/** Defensive client gate for API, cache and message-history payloads. */
export function isVisualMessage(value: unknown): value is VisualMessage {
  return isFlowVisualMessage(value) || isResearchVisualMessage(value);
}
