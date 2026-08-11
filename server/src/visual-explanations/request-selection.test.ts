import { describe, expect, it } from "vitest";
import { selectVisualRequest } from "./request-selection.js";

describe("visual request selection", () => {
  it.each([
    ["Research development of AI and create a visual timeline", "research", "timeline"],
    ["draw me a chart here of the comparisons in chat", "research", "chart"],
    ["show me with a map Viking migrations", "research", "geographic_map"],
    ["show a map of Europe", "research", "geographic_map"],
    ["show well-studied areas and missing research in an evidence-gap matrix", "research", "evidence_matrix"],
    ["make a claim-evidence graph with objections and counterevidence", "research", "claim_evidence_graph"],
    ["visually explain AVA's Instagram architecture", "workflow", "process"],
    ["map out the request workflow", "workflow", "process"],
    ["map AVA's components and dependencies", "workflow", "process"],
    ["research how photosynthesis works using primary sources", "research", "process"],
  ] as const)("routes %s", (request, toolMode, form) => {
    expect(selectVisualRequest(request)).toMatchObject({ toolMode, explicitForm: form });
  });

  it("routes a broad deep-research request to evidence visuals without forcing a form", () => {
    expect(selectVisualRequest("Research the best free AI models in a comprehensive report with benchmarks"))
      .toMatchObject({ toolMode: "research", explicitForm: null });
  });

  it("keeps an ordinary ambiguous visual request backward compatible", () => {
    expect(selectVisualRequest("show this visually"))
      .toMatchObject({ toolMode: "both", explicitForm: null });
  });
});
