import type { ResearchSemanticModel, ResearchVisualForm, ResearchVisualMessage } from "./types.js";

const evidence = { claimIds: ["claimRoute"], sourceIds: ["sourceAtlas"], confidence: "medium" as const, evidenceStatus: "supported" as const, uncertainty: "The route is a broad corridor, not an exact track." };

export const researchMapFixture: ResearchVisualMessage = {
  schemaVersion: "2.0",
  visualMessageId: "visual_research01",
  revision: 1,
  diagramKind: "geographic_map",
  title: "Viking migrations",
  summary: "A sourced geographic walkthrough of western and Atlantic movement.",
  question: "Show me with a map Viking migrations",
  selection: { recommendedForm: "geographic_map", selectedForm: "geographic_map", reason: "The question depends on movement or regional geography.", userSelected: false },
  synthesis: "Movement extended west from Scandinavia into Britain, Ireland and the North Atlantic.",
  methodology: "The visual separates broad historical corridors from exact routes and cites each location.",
  limitations: ["Regional points are representative and are not exact historical coordinates."],
  sources: [{ id: "sourceAtlas", title: "Viking migration atlas", url: "https://example.org/vikings", publisher: "Example Museum", publishedAt: "2025", quality: "scholarly", qualityNote: "Curated scholarly synthesis." }],
  claims: [{ id: "claimRoute", text: "Western migration connected Scandinavia, Britain and Iceland.", confidence: "medium", status: "supported", sourceIds: ["sourceAtlas"], counterSourceIds: [], limitation: "Exact tracks are not recoverable." }],
  semanticModel: {
    kind: "geographic_map", projection: "natural-earth-1",
    locations: [
      { id: "scandinavia", label: "Scandinavia", description: "Regional origin.", longitude: 15, latitude: 62, coordinatePrecision: "regional", uncertaintyKm: 400, coordinateSourceId: "sourceAtlas", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "britain", label: "Britain and Ireland", description: "Western settlement region.", longitude: -3, latitude: 54, coordinatePrecision: "regional", uncertaintyKm: 350, coordinateSourceId: "sourceAtlas", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "iceland", label: "Iceland", description: "Atlantic settlement region.", longitude: -19, latitude: 65, coordinatePrecision: "regional", uncertaintyKm: 250, coordinateSourceId: "sourceAtlas", periodStart: "9th century", periodEnd: "10th century", ...evidence },
    ],
    routes: [
      { id: "westRoute", from: "scandinavia", to: "britain", label: "Western route", direction: "forward", periodStart: "8th century", periodEnd: "11th century", ...evidence },
      { id: "atlanticRoute", from: "britain", to: "iceland", label: "Atlantic route", direction: "forward", periodStart: "9th century", periodEnd: "10th century", ...evidence },
    ],
    regions: [],
    timeLayers: [
      { id: "westLayer", label: "Western movement", period: "8th–9th centuries", entityIds: ["scandinavia", "britain", "westRoute"] },
      { id: "atlanticLayer", label: "Atlantic movement", period: "9th–10th centuries", entityIds: ["britain", "iceland", "atlanticRoute"] },
    ],
    legend: [{ id: "routeLegend", label: "Route", meaning: "Broad sourced movement corridor." }],
  },
  storyboard: { schemaVersion: "2.0", startSceneId: "westScene", scenes: [
    { id: "westScene", title: "Westward", caption: "Movement from Scandinavia toward Britain and Ireland.", entityIds: ["scandinavia", "britain", "westRoute"], highlightEntityIds: ["westRoute"], sourceIds: ["sourceAtlas"], transition: "fade", interactionCue: "Select the route for its evidence." },
    { id: "atlanticScene", title: "Atlantic", caption: "Later movement extended into Iceland.", entityIds: ["britain", "iceland", "atlanticRoute"], highlightEntityIds: ["atlanticRoute"], sourceIds: ["sourceAtlas"], transition: "slide" },
  ] },
  renderer: { renderer: "d3-geo", rendererSchemaVersion: "2.0", generatedFrom: "semantic_model", payload: JSON.stringify({ renderer: "d3-geo", mode: "read_only", provenance: "claim_level" }) },
  accessibleFallback: { heading: "Viking migrations", summary: "A sourced geographic walkthrough.", sections: [{ title: "Synthesis", text: "Western and Atlantic movement." }], entities: [{ id: "westRoute", label: "Western route", detail: "Broad movement corridor." }], sources: [{ id: "sourceAtlas", title: "Viking migration atlas", url: "https://example.org/vikings" }], scenes: [{ id: "westScene", title: "Westward", caption: "Movement west." }, { id: "atlanticScene", title: "Atlantic", caption: "Movement into Iceland." }] },
  source: "ava_chat", sourceSessionId: "chat-research", sourceRunId: "run-research", createdAt: 2,
};

export function researchFixtureForForm(form: Exclude<ResearchVisualForm, "geographic_map">): ResearchVisualMessage {
  const ref = { claimIds: ["claimRoute"], sourceIds: ["sourceAtlas"], confidence: "medium" as const, evidenceStatus: "supported" as const, uncertainty: null };
  const semanticModel: ResearchSemanticModel = form === "timeline" ? {
    kind: "timeline",
    events: [
      { id: "eventOne", label: "First phase", description: "The documented first phase.", dateLabel: "800", startYear: 800, endYear: null, datePrecision: "year", ...ref },
      { id: "eventTwo", label: "Second phase", description: "The documented second phase.", dateLabel: "900–950", startYear: 900, endYear: 950, datePrecision: "range", ...ref },
    ], links: [{ id: "timeLink", from: "eventOne", to: "eventTwo", label: "precedes", kind: "precedes" }],
  } : form === "evidence_matrix" ? {
    kind: "evidence_matrix", rows: [{ id: "regionRow", label: "Region" }], columns: [{ id: "topicColumn", label: "Topic" }],
    cells: [{ id: "evidenceCell", rowId: "regionRow", columnId: "topicColumn", label: "Evidence coverage", coverage: "weak", detail: "Only one bounded study is available.", ...ref }],
  } : form === "claim_evidence_graph" ? {
    kind: "claim_evidence_graph", direction: "LR",
    nodes: [
      { id: "claimNode", label: "Research claim", nodeKind: "claim", description: "The claim under review.", ...ref },
      { id: "sourceNode", label: "Primary source", nodeKind: "source", description: "Evidence supporting the claim.", ...ref },
    ], relationships: [{ id: "supportLink", from: "sourceNode", to: "claimNode", label: "supports", kind: "supports" }],
  } : form === "chart" ? {
    kind: "chart", chartType: "range", xLabel: "Period", yLabel: "Estimate", unit: "items", zeroBaseline: true,
    series: [{ id: "estimateSeries", label: "Estimate", colorHint: "cyan" }],
    points: [
      { id: "pointOne", seriesId: "estimateSeries", x: "Early", value: 12, low: 9, high: 15, label: "Early estimate", ...ref },
      { id: "pointTwo", seriesId: "estimateSeries", x: "Late", value: null, low: null, high: null, label: "Late evidence unavailable", ...ref, evidenceStatus: "gap", confidence: "unknown" },
    ],
  } : {
    kind: "process", direction: "LR",
    elements: [
      { id: "processStart", label: "Research", elementKind: "process", description: "Collect evidence.", ...ref },
      { id: "processEnd", label: "Synthesis", elementKind: "terminal", description: "Report bounded findings.", ...ref },
    ], relationships: [{ id: "processLink", from: "processStart", to: "processEnd", label: "supports", kind: "flow" }],
  };
  const ids = semanticModel.kind === "timeline" ? semanticModel.events.map((item) => item.id)
    : semanticModel.kind === "evidence_matrix" ? semanticModel.cells.map((item) => item.id)
    : semanticModel.kind === "claim_evidence_graph" ? semanticModel.nodes.map((item) => item.id)
    : semanticModel.kind === "chart" ? semanticModel.points.map((item) => item.id)
    : semanticModel.elements.map((item) => item.id);
  const renderer = form === "claim_evidence_graph" || form === "process" ? "react-flow" as const : "native-svg" as const;
  return {
    ...researchMapFixture,
    visualMessageId: `visual_${form.replaceAll("_", "").slice(0, 18)}Fixture`,
    diagramKind: form,
    title: `${form.replaceAll("_", " ")} example`,
    question: `Show this research as a ${form.replaceAll("_", " ")}`,
    selection: { recommendedForm: form, selectedForm: form, reason: "Evidence-shaped fixture.", userSelected: false },
    semanticModel,
    storyboard: { schemaVersion: "2.0", startSceneId: "researchScene", scenes: [{ id: "researchScene", title: "Evidence", caption: "A progressive evidence scene.", entityIds: ids, highlightEntityIds: ids.slice(0, 1), sourceIds: ["sourceAtlas"], transition: "fade" }] },
    renderer: { renderer, rendererSchemaVersion: "2.0", generatedFrom: "semantic_model", payload: JSON.stringify({ renderer, mode: "read_only", provenance: "claim_level" }) },
    accessibleFallback: { ...researchMapFixture.accessibleFallback, heading: `${form} example`, entities: ids.map((id) => ({ id, label: id, detail: "Evidence entity" })), scenes: [{ id: "researchScene", title: "Evidence", caption: "A progressive evidence scene." }] },
  };
}
