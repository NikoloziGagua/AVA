import { describe, expect, it } from "vitest";
import { parseMermaidTopology, validateVisualExplanation, VisualExplanationValidationError } from "./model.js";
import { branchingProcessFixture, repositoryMapFixture, requestPathFixture } from "./fixtures.test-helper.js";

describe("visual explanation model", () => {
  it.each([
    ["repository map", repositoryMapFixture],
    ["request path", requestPathFixture],
    ["branching process", branchingProcessFixture],
  ])("validates a representative %s with stable IDs and progressive scenes", (_name, fixture) => {
    const result = validateVisualExplanation(fixture);
    expect(result.topology.nodes.length).toBeGreaterThan(4);
    expect(result.storyboard.scenes.every((scene) => scene.nodeIds.length <= 14)).toBe(true);
    expect(new Set(result.storyboard.scenes.flatMap((scene) => scene.nodeIds)))
      .toEqual(new Set(result.topology.nodes.map((node) => node.id)));
  });

  it("rejects storyboard references that do not exist in canonical Mermaid", () => {
    const invalid = structuredClone(requestPathFixture);
    invalid.storyboard.scenes[0]!.nodeIds.push("inventedNode");
    expect(() => validateVisualExplanation(invalid)).toThrowError(/unknown Mermaid node ID inventedNode/);
  });

  it("rejects duplicate IDs and unsupported implicit topology", () => {
    expect(() => parseMermaidTopology(["flowchart TD", 'nodeA["One"]', 'nodeA["Two"]', "nodeA --> nodeB"].join("\n")))
      .toThrowError(/duplicate Mermaid node ID|undeclared node/);
  });

  it.each([
    ["flowchart TD", 'nodeA["Safe"]', 'nodeB["Other"]', "nodeA --> nodeB", 'click nodeA "https://evil.example"'].join("\n"),
    ['%%{init: {"securityLevel": "loose"}}%%', "flowchart TD", 'nodeA["Safe"]', 'nodeB["Other"]', "nodeA --> nodeB"].join("\n"),
    ["flowchart TD", 'nodeA["<script>alert(1)</script>"]', 'nodeB["Other"]', "nodeA --> nodeB"].join("\n"),
    ["flowchart TD", 'nodeA["Safe"]', 'nodeB["Other"]', "nodeA --> nodeB", "classDef danger fill:url(https://evil.example/x)"].join("\n"),
  ])("rejects active or network-capable Mermaid input", (mermaid) => {
    expect(() => parseMermaidTopology(mermaid)).toThrow(VisualExplanationValidationError);
  });

  it("requires every canonical node to be covered by a scene", () => {
    const invalid = structuredClone(repositoryMapFixture);
    invalid.storyboard.scenes = invalid.storyboard.scenes.slice(0, 2);
    expect(() => validateVisualExplanation(invalid)).toThrowError(/not covered by any storyboard scene/);
  });
});
