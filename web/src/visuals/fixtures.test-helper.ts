import type { VisualExplanation } from "./api.js";

export const visualFixture: VisualExplanation = {
  id: "visual_fixture01",
  schemaVersion: "1.0",
  title: "Request path",
  summary: "A compact walkthrough from request to verified result.",
  mermaid: `flowchart TD
request(["Niko asks AVA"])
route["Route request"]
tool["Run tool"]
verify{"Verified?"}
done(["Report result"])
request --> route
route --> tool
tool --> verify
verify -->|Yes or no| done`,
  storyboard: {
    schemaVersion: "1.0",
    startSceneId: "routeScene",
    scenes: [
      { id: "routeScene", title: "Route", caption: "AVA interprets and routes the request.", nodeIds: ["request", "route", "tool"], highlightNodeIds: ["route"], transition: "fade", interactionCue: "Move next to inspect verification." },
      { id: "verifyScene", title: "Verify", caption: "AVA reports what evidence actually proves.", nodeIds: ["tool", "verify", "done"], highlightNodeIds: ["verify"], transition: "slide" },
    ],
  },
  topology: {
    direction: "TD",
    nodes: [
      { id: "request", label: "Niko asks AVA", shape: "terminal" },
      { id: "route", label: "Route request", shape: "process" },
      { id: "tool", label: "Run tool", shape: "process" },
      { id: "verify", label: "Verified?", shape: "decision" },
      { id: "done", label: "Report result", shape: "terminal" },
    ],
    edges: [
      { from: "request", to: "route", label: null, style: "flow" },
      { from: "route", to: "tool", label: null, style: "flow" },
      { from: "tool", to: "verify", label: null, style: "flow" },
      { from: "verify", to: "done", label: "Yes or no", style: "flow" },
    ],
  },
  source: "ava_chat",
  sourceSessionId: "chat-visual",
  sourceRunId: "run-visual",
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

