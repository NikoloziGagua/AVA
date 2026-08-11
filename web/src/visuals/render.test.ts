import { describe, expect, it } from "vitest";
import { visualFixture } from "./fixtures.test-helper.js";
import { buildSceneFlow } from "./render.js";

describe("VisualMessage React Flow projection", () => {
  it("lays out only the active scene from canonical semantic data", () => {
    const graph = buildSceneFlow(visualFixture, visualFixture.storyboard.scenes[0]!, [], true);
    expect(graph.nodes.map((node) => node.id)).toEqual(["request", "route", "tool"]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["rel_request_route", "rel_route_tool"]);
    expect(graph.nodes.some((node) => node.id === "verify")).toBe(false);
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(graph.nodes.find((node) => node.id === "route")?.data.highlighted).toBe(true);
  });

  it("produces deterministic directed positions without mutating VisualMessage", () => {
    const before = JSON.stringify(visualFixture);
    const first = buildSceneFlow(visualFixture, visualFixture.storyboard.scenes[0]!, [], true);
    const second = buildSceneFlow(visualFixture, visualFixture.storyboard.scenes[0]!, [], true);
    expect(first.nodes.map((node) => node.position)).toEqual(second.nodes.map((node) => node.position));
    expect(JSON.stringify(visualFixture)).toBe(before);
    expect(first.nodes[0]!.position.y).toBeLessThan(first.nodes[1]!.position.y);
  });

  it("highlights selected context and keeps animation off under reduced motion", () => {
    const graph = buildSceneFlow(visualFixture, visualFixture.storyboard.scenes[0]!, ["route"], true);
    expect(graph.nodes.find((node) => node.id === "route")?.selected).toBe(true);
    expect(graph.edges.filter((edge) => edge.data?.highlighted)).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.animated === false)).toBe(true);
  });

  it("never evaluates or projects renderer payload as generated markup", () => {
    const hostile = {
      ...visualFixture,
      renderer: { ...visualFixture.renderer, payload: '<script src="https://evil.test/x.js"></script>' },
    };
    const graph = buildSceneFlow(hostile, hostile.storyboard.scenes[0]!, [], true);
    expect(JSON.stringify(graph)).not.toContain("script");
    expect(JSON.stringify(graph)).not.toContain("evil.test");
  });
});
