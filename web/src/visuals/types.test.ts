import { describe, expect, it } from "vitest";
import { visualFixture } from "./fixtures.test-helper.js";
import { isVisualMessage } from "./types.js";

describe("VisualMessage client validation", () => {
  it("accepts the versioned renderer-neutral contract", () => {
    expect(isVisualMessage(visualFixture)).toBe(true);
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
  ])("rejects %s", (_name, candidate) => {
    expect(isVisualMessage(candidate)).toBe(false);
  });
});
