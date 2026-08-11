import { describe, expect, it } from "vitest";
import { VisualExplanationValidationError } from "./model.js";
import { recommendResearchVisualForm, validateResearchVisual } from "./research-model.js";
import { chartFixture, claimGraphFixture, matrixFixture, processResearchFixture, timelineFixture, vikingMapFixture } from "./research-fixtures.test-helper.js";

describe("research visual model", () => {
  it.each([
    ["geographic map", vikingMapFixture, "d3-geo"],
    ["timeline", timelineFixture, "native-svg"],
    ["evidence matrix", matrixFixture, "native-svg"],
    ["claim graph", claimGraphFixture, "react-flow"],
    ["chart", chartFixture, "native-svg"],
    ["process", processResearchFixture, "react-flow"],
  ])("validates a grounded %s with provenance and progressive scenes", (_name, fixture, renderer) => {
    const result = validateResearchVisual(fixture);
    expect(result.schemaVersion).toBe("2.0");
    expect(result.diagramKind).toBe(fixture.semanticModel.kind);
    expect(result.renderer.renderer).toBe(renderer);
    expect(result.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
    expect(result.accessibleFallback.sources).toHaveLength(2);
  });

  it("selects a real geographic map for migration rather than a labelled flowchart", () => {
    expect(recommendResearchVisualForm("Show me with a map Viking migrations")).toMatchObject({ form: "geographic_map" });
    const result = validateResearchVisual(vikingMapFixture);
    expect(result.semanticModel.kind).toBe("geographic_map");
    if (result.semanticModel.kind === "geographic_map") {
      expect(result.semanticModel.locations.every((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude))).toBe(true);
      expect(result.semanticModel.routes.some((route) => route.direction === "forward")).toBe(true);
      expect(result.semanticModel.timeLayers).toHaveLength(2);
    }
  });

  it("honours an explicit user form while recording the differing recommendation", () => {
    const explicit = structuredClone(processResearchFixture);
    explicit.question = "Map regional migration";
    explicit.userSelectedForm = "process";
    const result = validateResearchVisual(explicit);
    expect(result.selection).toMatchObject({ selectedForm: "process", recommendedForm: "geographic_map", userSelected: true });
  });

  it("rejects coordinates without their cited coordinate source", () => {
    const invalid = structuredClone(vikingMapFixture);
    if (invalid.semanticModel.kind !== "geographic_map") throw new Error("fixture mismatch");
    invalid.semanticModel.locations[0]!.coordinateSourceId = "inventedSource";
    expect(() => validateResearchVisual(invalid)).toThrowError(/coordinate source is missing/);
  });

  it("rejects fabricated quantitative precision without a source", () => {
    const invalid = structuredClone(chartFixture);
    if (invalid.semanticModel.kind !== "chart") throw new Error("fixture mismatch");
    invalid.semanticModel.points[0]!.sourceIds = [];
    expect(() => validateResearchVisual(invalid)).toThrowError(/requires a source for its value/);
  });

  it("rejects unsafe source protocols and uncovered visual entities", () => {
    const unsafe = structuredClone(timelineFixture);
    unsafe.sources[0]!.url = "javascript:alert(1)";
    expect(() => validateResearchVisual(unsafe)).toThrow(VisualExplanationValidationError);
    const uncovered = structuredClone(matrixFixture);
    uncovered.storyboard.scenes[0]!.entityIds = ["northTexts"];
    expect(() => validateResearchVisual(uncovered)).toThrowError(/northMaterial is not covered/);
  });

  it("scrubs secrets from nested research text and strips sensitive URL parameters", () => {
    const sensitive = structuredClone(timelineFixture);
    sensitive.methodology = "Compared sources; api_key=sk-test-secret-value";
    sensitive.sources[0]!.url = "https://example.org/research?token=private-value&section=methods";
    if (sensitive.semanticModel.kind !== "timeline") throw new Error("fixture mismatch");
    sensitive.semanticModel.events[0]!.description = "password: deeply-secret";
    const result = validateResearchVisual(sensitive);
    expect(JSON.stringify(result)).not.toContain("sk-test-secret-value");
    expect(JSON.stringify(result)).not.toContain("deeply-secret");
    expect(result.sources[0]!.url).toContain("section=methods");
    expect(result.sources[0]!.url).not.toContain("token=");
  });

  it("rejects unsupported antimeridian or inverted region boxes", () => {
    const invalid = structuredClone(vikingMapFixture);
    if (invalid.semanticModel.kind !== "geographic_map") throw new Error("fixture mismatch");
    invalid.semanticModel.regions![0]!.bounds = [170, 40, -170, 70];
    expect(() => validateResearchVisual(invalid)).toThrowError(/antimeridian-crossing bounds/);
  });
});
