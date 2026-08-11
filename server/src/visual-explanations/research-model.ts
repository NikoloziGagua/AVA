import { z } from "zod";
import { scrubSecrets } from "../security/scrub.js";
import {
  StaleVisualRevisionError,
  VisualExplanationValidationError,
} from "./model.js";

export { StaleVisualRevisionError };

export const RESEARCH_VISUAL_SCHEMA_VERSION = "2.0" as const;
export const RESEARCH_STORYBOARD_SCHEMA_VERSION = "2.0" as const;
export const RESEARCH_VISUAL_FORMS = [
  "geographic_map",
  "timeline",
  "evidence_matrix",
  "claim_evidence_graph",
  "chart",
  "process",
] as const;

export type ResearchVisualForm = typeof RESEARCH_VISUAL_FORMS[number];
export type EvidenceConfidence = "high" | "medium" | "low" | "unknown";
export type EvidenceStatus = "supported" | "disputed" | "counterevidence" | "gap" | "context";

const StableId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/);
const Confidence = z.enum(["high", "medium", "low", "unknown"]);
const EvidenceState = z.enum(["supported", "disputed", "counterevidence", "gap", "context"]);

function text(value: string, max: number): string {
  return scrubSecrets(value).trim().replace(/\r\n/g, "\n").slice(0, max);
}

// Schema limits make this walk bounded. Keep the accepted structure intact
// while applying the same secret scrubber to every persistable string,
// including entity descriptions, labels, periods and scene captions.
function scrubStructured<T>(value: T): T {
  if (typeof value === "string") return scrubSecrets(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubStructured(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, scrubStructured(child)]),
    ) as T;
  }
  return value;
}

function safeSourceUrl(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("source URL must use http or https");
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/token|secret|auth|signature|sig|key|password|session/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

const SourceSchema = z.object({
  id: StableId,
  title: z.string().trim().min(1).max(240),
  url: z.string().url().max(2_000),
  publisher: z.string().trim().min(1).max(160).nullable().default(null),
  publishedAt: z.string().trim().min(1).max(80).nullable().default(null),
  quality: z.enum(["primary", "scholarly", "official", "reputable_secondary", "other", "unknown"]),
  qualityNote: z.string().trim().min(1).max(300).nullable().default(null),
}).strict();

const ClaimSchema = z.object({
  id: StableId,
  text: z.string().trim().min(1).max(800),
  confidence: Confidence,
  status: z.enum(["supported", "disputed", "uncertain", "missing_evidence"]),
  sourceIds: z.array(StableId).max(20).default([]),
  counterSourceIds: z.array(StableId).max(20).default([]),
  limitation: z.string().trim().min(1).max(500).nullable().default(null),
}).strict();

const EvidenceRefs = {
  claimIds: z.array(StableId).max(20).default([]),
  sourceIds: z.array(StableId).max(20).default([]),
  confidence: Confidence,
  evidenceStatus: EvidenceState,
  uncertainty: z.string().trim().min(1).max(400).nullable().default(null),
};

const GeographicMapSchema = z.object({
  kind: z.literal("geographic_map"),
  projection: z.literal("natural-earth-1").default("natural-earth-1"),
  locations: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(500),
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    coordinatePrecision: z.enum(["exact", "approximate", "regional"]),
    uncertaintyKm: z.number().min(0).max(5_000).nullable().default(null),
    coordinateSourceId: StableId,
    periodStart: z.string().trim().min(1).max(80).nullable().default(null),
    periodEnd: z.string().trim().min(1).max(80).nullable().default(null),
    ...EvidenceRefs,
  }).strict()).min(2).max(80),
  routes: z.array(z.object({
    id: StableId,
    from: StableId,
    to: StableId,
    label: z.string().trim().min(1).max(140),
    direction: z.enum(["forward", "bidirectional", "unknown"]),
    periodStart: z.string().trim().min(1).max(80).nullable().default(null),
    periodEnd: z.string().trim().min(1).max(80).nullable().default(null),
    ...EvidenceRefs,
  }).strict()).max(120).default([]),
  regions: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(140),
    bounds: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    periodStart: z.string().trim().min(1).max(80).nullable().default(null),
    periodEnd: z.string().trim().min(1).max(80).nullable().default(null),
    ...EvidenceRefs,
  }).strict()).max(30).default([]),
  timeLayers: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(120),
    period: z.string().trim().min(1).max(120),
    entityIds: z.array(StableId).min(1).max(80),
  }).strict()).min(1).max(20),
  legend: z.array(z.object({ id: StableId, label: z.string().trim().min(1).max(120), meaning: z.string().trim().min(1).max(240) }).strict()).min(1).max(12),
}).strict();

const TimelineSchema = z.object({
  kind: z.literal("timeline"),
  events: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(600),
    dateLabel: z.string().trim().min(1).max(100),
    startYear: z.number().int().min(-100_000).max(100_000).nullable(),
    endYear: z.number().int().min(-100_000).max(100_000).nullable(),
    datePrecision: z.enum(["exact", "year", "range", "approximate", "unknown"]),
    ...EvidenceRefs,
  }).strict()).min(2).max(100),
  links: z.array(z.object({ id: StableId, from: StableId, to: StableId, label: z.string().trim().min(1).max(140), kind: z.enum(["precedes", "causes", "influences", "overlaps", "disputed"]) }).strict()).max(160).default([]),
}).strict();

const EvidenceMatrixSchema = z.object({
  kind: z.literal("evidence_matrix"),
  rows: z.array(z.object({ id: StableId, label: z.string().trim().min(1).max(120) }).strict()).min(1).max(20),
  columns: z.array(z.object({ id: StableId, label: z.string().trim().min(1).max(120) }).strict()).min(1).max(20),
  cells: z.array(z.object({
    id: StableId,
    rowId: StableId,
    columnId: StableId,
    label: z.string().trim().min(1).max(160),
    coverage: z.enum(["strong", "moderate", "weak", "missing", "disputed"]),
    detail: z.string().trim().min(1).max(600),
    ...EvidenceRefs,
  }).strict()).min(1).max(200),
}).strict();

const ClaimGraphSchema = z.object({
  kind: z.literal("claim_evidence_graph"),
  nodes: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(180),
    nodeKind: z.enum(["claim", "source", "counterevidence", "objection", "disputed_point", "evidence_gap"]),
    description: z.string().trim().min(1).max(600),
    ...EvidenceRefs,
  }).strict()).min(2).max(100),
  relationships: z.array(z.object({ id: StableId, from: StableId, to: StableId, label: z.string().trim().min(1).max(140), kind: z.enum(["supports", "contradicts", "qualifies", "objects_to", "leaves_open"]) }).strict()).min(1).max(180),
  direction: z.enum(["TD", "LR"]).default("LR"),
}).strict();

const ChartSchema = z.object({
  kind: z.literal("chart"),
  chartType: z.enum(["bar", "line", "range"]),
  xLabel: z.string().trim().min(1).max(120),
  yLabel: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(60),
  series: z.array(z.object({ id: StableId, label: z.string().trim().min(1).max(120), colorHint: z.enum(["cyan", "purple", "amber", "green", "red", "grey"]).default("cyan") }).strict()).min(1).max(12),
  points: z.array(z.object({
    id: StableId,
    seriesId: StableId,
    x: z.union([z.string().trim().min(1).max(100), z.number()]),
    value: z.number().finite().nullable(),
    low: z.number().finite().nullable().default(null),
    high: z.number().finite().nullable().default(null),
    label: z.string().trim().min(1).max(160),
    ...EvidenceRefs,
  }).strict()).min(2).max(240),
  zeroBaseline: z.boolean().default(true),
}).strict();

const ProcessSchema = z.object({
  kind: z.literal("process"),
  direction: z.enum(["TD", "TB", "LR", "RL", "BT"]),
  elements: z.array(z.object({
    id: StableId,
    label: z.string().trim().min(1).max(160),
    elementKind: z.enum(["process", "decision", "terminal"]),
    description: z.string().trim().min(1).max(500),
    ...EvidenceRefs,
  }).strict()).min(2).max(80),
  relationships: z.array(z.object({ id: StableId, from: StableId, to: StableId, label: z.string().trim().min(1).max(140).nullable(), kind: z.enum(["flow", "dotted", "strong"]) }).strict()).min(1).max(160),
}).strict();

export const ResearchSemanticModelSchema = z.discriminatedUnion("kind", [
  GeographicMapSchema,
  TimelineSchema,
  EvidenceMatrixSchema,
  ClaimGraphSchema,
  ChartSchema,
  ProcessSchema,
]);

const ResearchStoryboardSchema = z.object({
  schemaVersion: z.literal(RESEARCH_STORYBOARD_SCHEMA_VERSION),
  startSceneId: StableId,
  scenes: z.array(z.object({
    id: StableId,
    title: z.string().trim().min(1).max(100),
    caption: z.string().trim().min(1).max(800),
    entityIds: z.array(StableId).min(1).max(14),
    highlightEntityIds: z.array(StableId).max(8).default([]),
    sourceIds: z.array(StableId).max(20).default([]),
    transition: z.enum(["none", "fade", "slide"]).default("fade"),
    interactionCue: z.string().trim().min(1).max(240).optional(),
  }).strict()).min(1).max(24),
}).strict();

export const CreateResearchVisualInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_200),
  question: z.string().trim().min(1).max(1_000),
  userSelectedForm: z.enum(RESEARCH_VISUAL_FORMS).nullable().optional(),
  synthesis: z.string().trim().min(1).max(4_000),
  methodology: z.string().trim().min(1).max(2_000),
  limitations: z.array(z.string().trim().min(1).max(600)).max(20).default([]),
  sources: z.array(SourceSchema).min(1).max(80),
  claims: z.array(ClaimSchema).min(1).max(100),
  semanticModel: ResearchSemanticModelSchema,
  storyboard: ResearchStoryboardSchema,
  revisesVisualMessageId: z.string().regex(/^visual_[A-Za-z0-9_-]{8,32}$/).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict();

export type CreateResearchVisualInput = z.input<typeof CreateResearchVisualInputSchema>;
export type ResearchSemanticModel = z.infer<typeof ResearchSemanticModelSchema>;
export type ResearchStoryboard = z.infer<typeof ResearchStoryboardSchema>;
export type ResearchSource = z.infer<typeof SourceSchema>;
export type ResearchClaim = z.infer<typeof ClaimSchema>;

export type ResearchVisualArtifact = {
  schemaVersion: typeof RESEARCH_VISUAL_SCHEMA_VERSION;
  visualMessageId: string;
  revision: number;
  diagramKind: ResearchVisualForm;
  title: string;
  summary: string;
  question: string;
  selection: { recommendedForm: ResearchVisualForm; selectedForm: ResearchVisualForm; reason: string; userSelected: boolean };
  synthesis: string;
  methodology: string;
  limitations: string[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  semanticModel: ResearchSemanticModel;
  storyboard: ResearchStoryboard;
  renderer: { renderer: "d3-geo" | "native-svg" | "react-flow"; rendererSchemaVersion: "2.0"; generatedFrom: "semantic_model"; payload: string };
  accessibleFallback: { heading: string; summary: string; sections: Array<{ title: string; text: string }>; entities: Array<{ id: string; label: string; detail: string }>; sources: Array<{ id: string; title: string; url: string }>; scenes: Array<{ id: string; title: string; caption: string }> };
  source: "manual" | "ava_chat" | "ava_voice";
  sourceSessionId: string | null;
  sourceRunId: string | null;
  createdAt: number;
};

function entityRecords(model: ResearchSemanticModel): Array<{ id: string; label: string; detail: string; claimIds: string[]; sourceIds: string[] }> {
  if (model.kind === "geographic_map") return [
    ...model.locations.map((v) => ({ id: v.id, label: v.label, detail: v.description, claimIds: v.claimIds, sourceIds: v.sourceIds })),
    ...model.routes.map((v) => ({ id: v.id, label: v.label, detail: `${v.direction} route`, claimIds: v.claimIds, sourceIds: v.sourceIds })),
    ...model.regions.map((v) => ({ id: v.id, label: v.label, detail: "Approximate research region", claimIds: v.claimIds, sourceIds: v.sourceIds })),
  ];
  if (model.kind === "timeline") return model.events.map((v) => ({ id: v.id, label: v.label, detail: `${v.dateLabel}: ${v.description}`, claimIds: v.claimIds, sourceIds: v.sourceIds }));
  if (model.kind === "evidence_matrix") return model.cells.map((v) => ({ id: v.id, label: v.label, detail: v.detail, claimIds: v.claimIds, sourceIds: v.sourceIds }));
  if (model.kind === "claim_evidence_graph") return model.nodes.map((v) => ({ id: v.id, label: v.label, detail: v.description, claimIds: v.claimIds, sourceIds: v.sourceIds }));
  if (model.kind === "chart") return model.points.map((v) => ({ id: v.id, label: v.label, detail: v.value === null ? "Value unavailable" : `${v.value} ${model.unit}`, claimIds: v.claimIds, sourceIds: v.sourceIds }));
  return model.elements.map((v) => ({ id: v.id, label: v.label, detail: v.description, claimIds: v.claimIds, sourceIds: v.sourceIds }));
}

function relationshipPairs(model: ResearchSemanticModel): Array<{ id: string; from: string; to: string }> {
  if (model.kind === "geographic_map") return model.routes;
  if (model.kind === "timeline") return model.links;
  if (model.kind === "claim_evidence_graph") return model.relationships;
  if (model.kind === "process") return model.relationships;
  return [];
}

export function recommendResearchVisualForm(question: string): { form: ResearchVisualForm; reason: string } {
  const q = question.toLowerCase();
  if (/\b(gap|understudied|missing research|evidence matrix|research coverage|well.studied)\b/.test(q)) return { form: "evidence_matrix", reason: "The question compares evidence coverage and missing research." };
  if (/\b(map|where|migration|migrat|conflict|war|trade route|explor|expansion|diffusion|region|geograph|territor)\b/.test(q)) return { form: "geographic_map", reason: "The question depends on movement or regional geography." };
  if (/\b(timeline|chronolog|when|phase|turning point|sequence|history of|evolution over time)\b/.test(q)) return { form: "timeline", reason: "The question depends on chronology and phases." };
  if (/\b(chart|trend|quant|number|rate|percent|range|compare values|increase|decrease)\b/.test(q)) return { form: "chart", reason: "The question asks for quantitative comparison or change." };
  if (/\b(process|workflow|architecture|mechanism|system|how does|decision tree|request path)\b/.test(q)) return { form: "process", reason: "The question asks how a mechanism or system works." };
  return { form: "claim_evidence_graph", reason: "The evidence is best explained by linking claims, sources, objections and uncertainty." };
}

export function validateResearchVisual(input: CreateResearchVisualInput) {
  const parsed = CreateResearchVisualInputSchema.safeParse(input);
  if (!parsed.success) throw new VisualExplanationValidationError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).slice(0, 40));
  const value = parsed.data;
  const issues: string[] = [];
  const recommended = recommendResearchVisualForm(value.question);
  const selected = value.userSelectedForm ?? recommended.form;
  if (selected !== value.semanticModel.kind) issues.push(`semanticModel.kind must be ${selected} for the selected visual form`);
  if ((value.revisesVisualMessageId === undefined) !== (value.expectedRevision === undefined)) issues.push("revisesVisualMessageId and expectedRevision must be supplied together");

  const sources = value.sources.map((source) => {
    try { return { ...source, title: text(source.title, 240), url: safeSourceUrl(source.url), publisher: source.publisher ? text(source.publisher, 160) : null, publishedAt: source.publishedAt ? text(source.publishedAt, 80) : null, qualityNote: source.qualityNote ? text(source.qualityNote, 300) : null }; }
    catch { issues.push(`source ${source.id} has an unsafe URL`); return source; }
  });
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) issues.push(`duplicate source ID: ${source.id}`);
    sourceIds.add(source.id);
  }
  const claimIds = new Set<string>();
  for (const claim of value.claims) {
    if (claimIds.has(claim.id)) issues.push(`duplicate claim ID: ${claim.id}`);
    claimIds.add(claim.id);
    for (const id of [...claim.sourceIds, ...claim.counterSourceIds]) if (!sourceIds.has(id)) issues.push(`claim ${claim.id} references unknown source ${id}`);
    if (claim.status === "supported" && claim.sourceIds.length === 0) issues.push(`supported claim ${claim.id} requires a source`);
  }

  const entities = entityRecords(value.semanticModel);
  const entityIds = new Set<string>();
  for (const entity of entities) {
    if (entityIds.has(entity.id)) issues.push(`duplicate visual entity ID: ${entity.id}`);
    entityIds.add(entity.id);
    for (const id of entity.claimIds) if (!claimIds.has(id)) issues.push(`entity ${entity.id} references unknown claim ${id}`);
    for (const id of entity.sourceIds) if (!sourceIds.has(id)) issues.push(`entity ${entity.id} references unknown source ${id}`);
  }
  for (const relation of relationshipPairs(value.semanticModel)) {
    if (!entityIds.has(relation.from)) issues.push(`relationship ${relation.id} references unknown source entity ${relation.from}`);
    if (!entityIds.has(relation.to)) issues.push(`relationship ${relation.id} references unknown target entity ${relation.to}`);
  }
  if (value.semanticModel.kind === "geographic_map") {
    for (const location of value.semanticModel.locations) {
      if (!sourceIds.has(location.coordinateSourceId)) issues.push(`location ${location.id} coordinate source is missing`);
      if (!location.sourceIds.includes(location.coordinateSourceId)) issues.push(`location ${location.id} must include its coordinate source in sourceIds`);
    }
    for (const region of value.semanticModel.regions) {
      const [west, south, east, north] = region.bounds;
      if (west > east || south > north) issues.push(`region ${region.id} has inverted or antimeridian-crossing bounds; split it into supported rectangles`);
    }
    for (const layer of value.semanticModel.timeLayers) for (const id of layer.entityIds) if (!entityIds.has(id)) issues.push(`time layer ${layer.id} references unknown entity ${id}`);
  }
  if (value.semanticModel.kind === "evidence_matrix") {
    const rows = new Set(value.semanticModel.rows.map((row) => row.id));
    const columns = new Set(value.semanticModel.columns.map((column) => column.id));
    for (const cell of value.semanticModel.cells) {
      if (!rows.has(cell.rowId) || !columns.has(cell.columnId)) issues.push(`matrix cell ${cell.id} has an unknown row or column`);
    }
  }
  if (value.semanticModel.kind === "chart") {
    const series = new Set(value.semanticModel.series.map((item) => item.id));
    for (const point of value.semanticModel.points) {
      if (!series.has(point.seriesId)) issues.push(`chart point ${point.id} references unknown series ${point.seriesId}`);
      if (point.value !== null && point.sourceIds.length === 0) issues.push(`chart point ${point.id} requires a source for its value`);
      if (point.low !== null && point.high !== null && point.low > point.high) issues.push(`chart point ${point.id} has an inverted range`);
    }
  }

  const sceneIds = new Set<string>();
  const covered = new Set<string>();
  for (const scene of value.storyboard.scenes) {
    if (sceneIds.has(scene.id)) issues.push(`duplicate scene ID: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const id of scene.entityIds) { covered.add(id); if (!entityIds.has(id)) issues.push(`scene ${scene.id} references unknown entity ${id}`); }
    for (const id of scene.highlightEntityIds) if (!scene.entityIds.includes(id)) issues.push(`scene ${scene.id} highlights ${id} without including it`);
    for (const id of scene.sourceIds) if (!sourceIds.has(id)) issues.push(`scene ${scene.id} references unknown source ${id}`);
  }
  if (!sceneIds.has(value.storyboard.startSceneId)) issues.push("startSceneId does not match a scene");
  for (const id of entityIds) if (!covered.has(id)) issues.push(`visual entity ${id} is not covered by any scene`);
  if (entities.length > 14 && value.storyboard.scenes.length < 2) issues.push("larger research visuals require progressive scenes");
  if (issues.length) throw new VisualExplanationValidationError(issues.slice(0, 50));

  const renderer = value.semanticModel.kind === "geographic_map" ? "d3-geo" :
    value.semanticModel.kind === "claim_evidence_graph" || value.semanticModel.kind === "process" ? "react-flow" : "native-svg";
  const reason = value.userSelectedForm
    ? `Niko explicitly selected ${value.userSelectedForm.replaceAll("_", " ")}; automatic recommendation was ${recommended.form.replaceAll("_", " ")}.`
    : recommended.reason;
  const semanticModel = scrubStructured(value.semanticModel);
  const storyboard = scrubStructured(value.storyboard);
  const safeEntities = entityRecords(semanticModel);
  return {
    schemaVersion: RESEARCH_VISUAL_SCHEMA_VERSION,
    title: text(value.title, 160),
    summary: text(value.summary, 1_200),
    question: text(value.question, 1_000),
    selection: { recommendedForm: recommended.form, selectedForm: selected, reason, userSelected: Boolean(value.userSelectedForm) },
    synthesis: text(value.synthesis, 4_000),
    methodology: text(value.methodology, 2_000),
    limitations: value.limitations.map((item) => text(item, 600)),
    sources,
    claims: value.claims.map((claim) => ({ ...claim, text: text(claim.text, 800), limitation: claim.limitation ? text(claim.limitation, 500) : null })),
    semanticModel,
    storyboard,
    diagramKind: selected,
    renderer: { renderer, rendererSchemaVersion: "2.0" as const, generatedFrom: "semantic_model" as const, payload: JSON.stringify({ renderer, mode: "read_only", provenance: "claim_level" }) },
    accessibleFallback: {
      heading: text(value.title, 160),
      summary: text(value.summary, 1_200),
      sections: [
        { title: "Synthesis", text: text(value.synthesis, 4_000) },
        { title: "Methodology", text: text(value.methodology, 2_000) },
        { title: "Limitations", text: value.limitations.length ? value.limitations.map((item) => text(item, 600)).join(" ") : "No additional limitations recorded." },
      ],
      entities: safeEntities.map(({ id, label, detail }) => ({ id, label: text(label, 180), detail: text(detail, 700) })),
      sources: sources.map(({ id, title, url }) => ({ id, title, url })),
      scenes: storyboard.scenes.map(({ id, title, caption }) => ({ id, title: text(title, 100), caption: text(caption, 800) })),
    },
    revisesVisualMessageId: value.revisesVisualMessageId ?? null,
    expectedRevision: value.expectedRevision ?? null,
  };
}

export function researchEntityRecords(model: ResearchSemanticModel) {
  return entityRecords(model);
}
