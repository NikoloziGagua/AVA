import type { CreateResearchVisualInput, ResearchVisualForm } from "./research-model.js";

const sources = [
  { id: "sourcePrimary", title: "Primary research source", url: "https://example.org/research/primary", publisher: "Example Institute", publishedAt: "2025", quality: "primary" as const, qualityNote: "Direct dataset or primary record." },
  { id: "sourceReview", title: "Scholarly review", url: "https://example.edu/review", publisher: "Example University", publishedAt: "2026", quality: "scholarly" as const, qualityNote: "Peer-reviewed synthesis." },
];
const claims = [
  { id: "claimMain", text: "The evidence supports the main pattern, with bounded uncertainty.", confidence: "medium" as const, status: "supported" as const, sourceIds: ["sourcePrimary"], counterSourceIds: [], limitation: "The record is incomplete." },
  { id: "claimDispute", text: "One interpretation remains disputed.", confidence: "low" as const, status: "disputed" as const, sourceIds: ["sourceReview"], counterSourceIds: ["sourcePrimary"], limitation: "Sources use different definitions." },
];
const evidence = { claimIds: ["claimMain"], sourceIds: ["sourcePrimary"], confidence: "medium" as const, evidenceStatus: "supported" as const, uncertainty: "The source supports the broad pattern, not exact precision." };

function base(title: string, question: string, kind: ResearchVisualForm) {
  return {
    title,
    summary: `A progressive ${kind.replaceAll("_", " ")} grounded in the cited evidence.`,
    question,
    synthesis: "The visual presents the strongest supported pattern while keeping disagreement and missing evidence visible.",
    methodology: "AVA compared the cited sources, separated claims from observations, and attached provenance to each visual entity.",
    limitations: ["This deterministic fixture is illustrative and does not represent a live research result."],
    sources,
    claims,
  };
}

export const vikingMapFixture: CreateResearchVisualInput = {
  ...base("Viking migration routes", "Show me with a map Viking migrations and regional expansion", "geographic_map"),
  semanticModel: {
    kind: "geographic_map", projection: "natural-earth-1",
    locations: [
      { id: "scandinavia", label: "Scandinavia", description: "Broad point of origin used as a regional reference.", longitude: 15, latitude: 62, coordinatePrecision: "regional", uncertaintyKm: 450, coordinateSourceId: "sourcePrimary", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "britain", label: "Britain and Ireland", description: "A major western destination and settlement region.", longitude: -3, latitude: 54, coordinatePrecision: "regional", uncertaintyKm: 380, coordinateSourceId: "sourcePrimary", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "iceland", label: "Iceland", description: "North Atlantic settlement region.", longitude: -19, latitude: 65, coordinatePrecision: "regional", uncertaintyKm: 260, periodStart: "9th century", periodEnd: "10th century", ...evidence, sourceIds: ["sourceReview"], coordinateSourceId: "sourceReview" },
    ],
    routes: [
      { id: "westRoute", from: "scandinavia", to: "britain", label: "Western migration route", direction: "forward", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "atlanticRoute", from: "britain", to: "iceland", label: "North Atlantic route", direction: "forward", periodStart: "9th century", periodEnd: "10th century", ...evidence, sourceIds: ["sourceReview"] },
    ],
    regions: [{ id: "northAtlantic", label: "North Atlantic evidence zone", bounds: [-30, 48, 25, 70], periodStart: "8th century", periodEnd: "11th century", ...evidence, confidence: "low", uncertainty: "This box denotes a research region, not a historical border." }],
    timeLayers: [
      { id: "earlyLayer", label: "Early movement", period: "8th–9th centuries", entityIds: ["scandinavia", "britain", "westRoute", "northAtlantic"] },
      { id: "laterLayer", label: "Atlantic expansion", period: "9th–11th centuries", entityIds: ["britain", "iceland", "atlanticRoute", "northAtlantic"] },
    ],
    legend: [{ id: "legendRoute", label: "Directional route", meaning: "A sourced broad movement corridor; not an exact travelled track." }],
  },
  storyboard: { schemaVersion: "2.0", startSceneId: "origins", scenes: [
    { id: "origins", title: "Origins and western movement", caption: "The first layer shows regional origin and movement toward Britain and Ireland.", entityIds: ["scandinavia", "britain", "westRoute", "northAtlantic"], highlightEntityIds: ["westRoute"], sourceIds: ["sourcePrimary"], transition: "fade", interactionCue: "Select the route to inspect its evidence and uncertainty." },
    { id: "atlantic", title: "Atlantic expansion", caption: "The second layer continues into the North Atlantic without pretending the route is an exact track.", entityIds: ["britain", "iceland", "atlanticRoute", "northAtlantic"], highlightEntityIds: ["atlanticRoute"], sourceIds: ["sourceReview"], transition: "slide" },
  ] },
};

export const timelineFixture: CreateResearchVisualInput = {
  ...base("Turning points", "Build a timeline of the phases and turning points", "timeline"),
  semanticModel: { kind: "timeline", events: [
    { id: "phaseOne", label: "Early phase", description: "The process begins.", dateLabel: "c. 800", startYear: 800, endYear: null, datePrecision: "approximate", ...evidence },
    { id: "phaseTwo", label: "Turning point", description: "A later transition changes the pattern.", dateLabel: "900–930", startYear: 900, endYear: 930, datePrecision: "range", ...evidence, claimIds: ["claimDispute"], sourceIds: ["sourceReview"], confidence: "low", evidenceStatus: "disputed" },
  ], links: [{ id: "phaseLink", from: "phaseOne", to: "phaseTwo", label: "precedes", kind: "precedes" }] },
  storyboard: { schemaVersion: "2.0", startSceneId: "phases", scenes: [{ id: "phases", title: "Two phases", caption: "Chronology and precision remain explicit.", entityIds: ["phaseOne", "phaseTwo"], highlightEntityIds: ["phaseTwo"], sourceIds: ["sourcePrimary", "sourceReview"], transition: "fade" }] },
};

export const matrixFixture: CreateResearchVisualInput = {
  ...base("Evidence coverage", "Map the well-studied areas and missing research gaps", "evidence_matrix"),
  semanticModel: { kind: "evidence_matrix", rows: [{ id: "north", label: "Northern region" }], columns: [{ id: "texts", label: "Written evidence" }, { id: "material", label: "Material evidence" }], cells: [
    { id: "northTexts", rowId: "north", columnId: "texts", label: "Moderate coverage", coverage: "moderate", detail: "Several sources, but uneven survival.", ...evidence },
    { id: "northMaterial", rowId: "north", columnId: "material", label: "Missing synthesis", coverage: "missing", detail: "No comparable synthesis was found.", ...evidence, claimIds: [], sourceIds: [], confidence: "unknown", evidenceStatus: "gap", uncertainty: "Absence in this search is not proof that no research exists." },
  ] },
  storyboard: { schemaVersion: "2.0", startSceneId: "coverage", scenes: [{ id: "coverage", title: "Coverage", caption: "Strong and missing evidence are shown separately.", entityIds: ["northTexts", "northMaterial"], highlightEntityIds: ["northMaterial"], sourceIds: ["sourcePrimary"], transition: "fade" }] },
};

export const claimGraphFixture: CreateResearchVisualInput = {
  ...base("Claims and objections", "Assess the evidence for the main argument and objections", "claim_evidence_graph"),
  semanticModel: { kind: "claim_evidence_graph", direction: "LR", nodes: [
    { id: "mainClaim", label: "Main claim", nodeKind: "claim", description: "The central interpretation.", ...evidence },
    { id: "primarySource", label: "Primary source", nodeKind: "source", description: "Direct support for part of the claim.", ...evidence },
    { id: "objection", label: "Competing reading", nodeKind: "objection", description: "An objection based on definition differences.", ...evidence, claimIds: ["claimDispute"], sourceIds: ["sourceReview"], confidence: "low", evidenceStatus: "disputed" },
  ], relationships: [
    { id: "supportsMain", from: "primarySource", to: "mainClaim", label: "supports", kind: "supports" },
    { id: "objectsMain", from: "objection", to: "mainClaim", label: "objects to", kind: "objects_to" },
  ] },
  storyboard: { schemaVersion: "2.0", startSceneId: "argument", scenes: [{ id: "argument", title: "Argument", caption: "Support and objection remain visible together.", entityIds: ["mainClaim", "primarySource", "objection"], highlightEntityIds: ["mainClaim"], sourceIds: ["sourcePrimary", "sourceReview"], transition: "fade" }] },
};

export const chartFixture: CreateResearchVisualInput = {
  ...base("Sourced range comparison", "Create a chart comparing quantitative ranges", "chart"),
  semanticModel: { kind: "chart", chartType: "range", xLabel: "Study", yLabel: "Estimate", unit: "units", series: [{ id: "estimates", label: "Published estimate", colorHint: "cyan" }], points: [
    { id: "estimateOne", seriesId: "estimates", x: "Study A", value: 45, low: 38, high: 52, label: "Study A estimate", ...evidence },
    { id: "estimateTwo", seriesId: "estimates", x: "Study B", value: 62, low: 50, high: 74, label: "Study B estimate", ...evidence, sourceIds: ["sourceReview"] },
  ], zeroBaseline: true },
  storyboard: { schemaVersion: "2.0", startSceneId: "comparison", scenes: [{ id: "comparison", title: "Comparison", caption: "Central values and source-reported ranges appear together.", entityIds: ["estimateOne", "estimateTwo"], highlightEntityIds: ["estimateTwo"], sourceIds: ["sourcePrimary", "sourceReview"], transition: "fade" }] },
};

export const processResearchFixture: CreateResearchVisualInput = {
  ...base("Research method", "Show how the research process and decisions work", "process"),
  semanticModel: { kind: "process", direction: "LR", elements: [
    { id: "collect", label: "Collect sources", elementKind: "process", description: "Gather direct evidence.", ...evidence },
    { id: "assess", label: "Assess quality", elementKind: "decision", description: "Separate strong and weak evidence.", ...evidence },
  ], relationships: [{ id: "collectAssess", from: "collect", to: "assess", label: "then", kind: "flow" }] },
  storyboard: { schemaVersion: "2.0", startSceneId: "method", scenes: [{ id: "method", title: "Method", caption: "Collection and quality assessment are separate stages.", entityIds: ["collect", "assess"], highlightEntityIds: ["assess"], sourceIds: ["sourcePrimary"], transition: "fade" }] },
};
