import type { VisualMessage } from "./types.js";

const elements: VisualMessage["semanticModel"]["elements"] = [
  { id: "request", label: "Niko asks AVA", kind: "terminal" },
  { id: "route", label: "Route request", kind: "process" },
  { id: "tool", label: "Run tool", kind: "process" },
  { id: "verify", label: "Verified?", kind: "decision" },
  { id: "done", label: "Report result", kind: "terminal" },
];

const relationships: VisualMessage["semanticModel"]["relationships"] = [
  { id: "rel_request_route", from: "request", to: "route", label: null, kind: "flow" },
  { id: "rel_route_tool", from: "route", to: "tool", label: null, kind: "flow" },
  { id: "rel_tool_verify", from: "tool", to: "verify", label: null, kind: "flow" },
  { id: "rel_verify_done", from: "verify", to: "done", label: "Yes or no", kind: "flow" },
];

export const visualFixture: VisualMessage = {
  schemaVersion: "1.0",
  visualMessageId: "visual_fixture01",
  revision: 1,
  diagramKind: "flowchart",
  title: "Request path",
  summary: "A compact walkthrough from request to verified result.",
  semanticModel: { direction: "TD", elements, relationships },
  storyboard: {
    schemaVersion: "1.0",
    startSceneId: "routeScene",
    scenes: [
      { id: "routeScene", title: "Route", caption: "AVA interprets and routes the request.", nodeIds: ["request", "route", "tool"], highlightNodeIds: ["route"], transition: "fade", interactionCue: "Move next to inspect verification." },
      { id: "verifyScene", title: "Verify", caption: "AVA reports what evidence actually proves.", nodeIds: ["tool", "verify", "done"], highlightNodeIds: ["verify"], transition: "slide" },
    ],
  },
  renderer: {
    renderer: "react-flow",
    rendererSchemaVersion: "1.0",
    generatedFrom: "semantic_model",
    payload: JSON.stringify({ layout: "dagre", interaction: "read_only" }),
  },
  accessibleFallback: {
    heading: "Request path",
    summary: "A compact walkthrough from request to verified result.",
    elements,
    relationships: [
      { id: "rel_request_route", text: "Niko asks AVA leads to Route request" },
      { id: "rel_route_tool", text: "Route request leads to Run tool" },
      { id: "rel_tool_verify", text: "Run tool leads to Verified?" },
      { id: "rel_verify_done", text: "Verified? — Yes or no — Report result" },
    ],
    scenes: [
      { id: "routeScene", title: "Route", caption: "AVA interprets and routes the request." },
      { id: "verifyScene", title: "Verify", caption: "AVA reports what evidence actually proves." },
    ],
  },
  source: "ava_chat",
  sourceSessionId: "chat-visual",
  sourceRunId: "run-visual",
  createdAt: 1,
};
