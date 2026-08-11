import { describe, expect, it } from "vitest";
import { visualFixture } from "./fixtures.test-helper.js";
import { researchFixtureForForm, researchMapFixture } from "./research-fixtures.test-helper.js";
import { isVisualMessage } from "./types.js";

describe("VisualMessage client validation", () => {
  it("accepts the versioned renderer-neutral contract", () => {
    expect(isVisualMessage(visualFixture)).toBe(true);
    expect(isVisualMessage(researchMapFixture)).toBe(true);
    for (const form of ["timeline", "evidence_matrix", "claim_evidence_graph", "chart", "process"] as const) {
      expect(isVisualMessage(researchFixtureForForm(form))).toBe(true);
    }
  });

  it("rejects unsafe research provenance and fabricated coordinates", () => {
    const unsafeUrl = structuredClone(researchMapFixture);
    unsafeUrl.sources[0]!.url = "javascript:alert(1)";
    expect(isVisualMessage(unsafeUrl)).toBe(false);
    const impossibleCoordinate = structuredClone(researchMapFixture);
    if (impossibleCoordinate.semanticModel.kind !== "geographic_map") throw new Error("fixture mismatch");
    impossibleCoordinate.semanticModel.locations[0]!.longitude = 220;
    expect(isVisualMessage(impossibleCoordinate)).toBe(false);
    const secretQuery = structuredClone(researchMapFixture);
    secretQuery.sources[0]!.url = "https://example.org/vikings?token=should-not-survive";
    expect(isVisualMessage(secretQuery)).toBe(false);
    const uncovered = structuredClone(researchMapFixture);
    uncovered.storyboard.scenes[1]!.entityIds = ["britain", "iceland"];
    expect(isVisualMessage(uncovered)).toBe(false);
    const extraRendererField = structuredClone(researchMapFixture);
    extraRendererField.renderer.payload = JSON.stringify({ renderer: "d3-geo", mode: "read_only", provenance: "claim_level", script: "evil" });
    expect(isVisualMessage(extraRendererField)).toBe(false);
  });

  it.each([
    ["unknown schema", { ...visualFixture, schemaVersion: "2.0" }],
    ["duplicate semantic ID", {
      ...visualFixture,
      semanticModel: { ...visualFixture.semanticModel, elements: [
        ...visualFixture.semanticModel.elements,
        { ...visualFixture.semanticModel.elements[0]! },
      ] },
    }],
    ["dangling relationship", {
      ...visualFixture,
      semanticModel: { ...visualFixture.semanticModel, relationships: [
        ...visualFixture.semanticModel.relationships,
        { id: "rel_dangling", from: "route", to: "missing", label: null, kind: "flow" as const },
      ] },
    }],
    ["dangling scene reference", {
      ...visualFixture,
      storyboard: { ...visualFixture.storyboard, scenes: [
        { ...visualFixture.storyboard.scenes[0]!, nodeIds: ["missing"] },
        visualFixture.storyboard.scenes[1]!,
      ] },
    }],
    ["unvalidated native renderer payload", {
      ...visualFixture,
      renderer: { ...visualFixture.renderer, payload: '<script src="https://evil.test/x.js"></script>' },
    }],
  ])("rejects %s", (_name, candidate) => {
    expect(isVisualMessage(candidate)).toBe(false);
  });
});
