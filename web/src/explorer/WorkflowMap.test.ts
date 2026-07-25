import { describe, expect, it } from "vitest";
import { EXPLORER_CAPABILITIES, EXPLORER_DOMAINS } from "./registry.js";
import { layoutDomains } from "./CapabilityAtlas.js";
import { layoutWorkflow, layoutWorkflowTree } from "./WorkflowMap.js";
import type { ExplorerWorkflow } from "./types.js";

describe("Explorer graph layouts", () => {
  it("places every domain deterministically on a finite two-ring map", () => {
    const first = layoutDomains(EXPLORER_DOMAINS);
    const second = layoutDomains(EXPLORER_DOMAINS);

    expect(first).toEqual(second);
    expect(first).toHaveLength(EXPLORER_DOMAINS.length);
    expect(first.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(new Set(first.map(({ domain }) => domain.id)).size).toBe(EXPLORER_DOMAINS.length);
  });

  it("lays out every declared workflow without losing or overlapping nodes", () => {
    const workflows = EXPLORER_CAPABILITIES.flatMap((capability) =>
      capability.workflow ? [capability.workflow] : [],
    );
    expect(workflows.length).toBeGreaterThan(0);

    for (const workflow of workflows) {
      const layout = layoutWorkflow(workflow);
      expect(layout.nodes).toHaveLength(workflow.nodes.length);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(new Set(layout.nodes.map(({ node }) => node.id)).size).toBe(workflow.nodes.length);

      for (let i = 0; i < layout.nodes.length; i += 1) {
        const current = layout.nodes[i]!;
        expect(Number.isFinite(current.x) && Number.isFinite(current.y)).toBe(true);
        for (let j = i + 1; j < layout.nodes.length; j += 1) {
          const other = layout.nodes[j]!;
          const overlaps =
            current.x < other.x + other.width &&
            current.x + current.width > other.x &&
            current.y < other.y + other.height &&
            current.y + current.height > other.y;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it("ranks the browser success path left-to-right without letting its retry edge create a cycle", () => {
    const browser = EXPLORER_CAPABILITIES.find(
      (capability) => capability.id === "browser.persistent-control",
    );
    expect(browser?.workflow).toBeDefined();

    const workflow = browser!.workflow!;
    expect(
      workflow.edges.some(
        (edge) =>
          edge.kind === "retry" &&
          edge.from === "browser.persistent-control.verify" &&
          edge.to === "browser.persistent-control.act",
      ),
    ).toBe(true);

    const positions = new Map(
      layoutWorkflow(workflow).nodes.map((position) => [position.node.id, position]),
    );
    const inspect = positions.get("browser.persistent-control.inspect")!;
    const act = positions.get("browser.persistent-control.act")!;
    const verify = positions.get("browser.persistent-control.verify")!;
    const report = positions.get("browser.persistent-control.report")!;

    expect(inspect.level).toBeLessThan(act.level);
    expect(act.level).toBeLessThan(verify.level);
    expect(verify.level).toBeLessThan(report.level);
    expect(inspect.x).toBeLessThan(act.x);
    expect(act.x).toBeLessThan(verify.x);
    expect(verify.x).toBeLessThan(report.x);
  });

  it("breaks an unexpected non-retry cycle defensively while retaining a readable primary order", () => {
    const workflow: ExplorerWorkflow = {
      id: "test.cyclic.workflow",
      name: "Unexpected cycle",
      description: "Invalid draft data should remain inspectable.",
      entryNodeId: "test.cyclic.start",
      nodes: [
        {
          id: "test.cyclic.start",
          capabilityId: "conversation.text-turn",
          name: "Start",
          description: "Start",
          kind: "request",
        },
        {
          id: "test.cyclic.act",
          capabilityId: "conversation.text-turn",
          name: "Act",
          description: "Act",
          kind: "operation",
        },
        {
          id: "test.cyclic.verify",
          capabilityId: "conversation.text-turn",
          name: "Verify",
          description: "Verify",
          kind: "verification",
        },
      ],
      edges: [
        { id: "test.cyclic.e1", from: "test.cyclic.start", to: "test.cyclic.act", kind: "next" },
        { id: "test.cyclic.e2", from: "test.cyclic.act", to: "test.cyclic.verify", kind: "verification" },
        { id: "test.cyclic.e3", from: "test.cyclic.verify", to: "test.cyclic.act", kind: "fallback" },
      ],
    };

    const positions = new Map(
      layoutWorkflow(workflow).nodes.map((position) => [position.node.id, position]),
    );
    expect(positions.size).toBe(3);
    expect(positions.get("test.cyclic.start")!.level).toBeLessThan(
      positions.get("test.cyclic.act")!.level,
    );
    expect(positions.get("test.cyclic.act")!.level).toBeLessThan(
      positions.get("test.cyclic.verify")!.level,
    );
  });

  it("degrades safely for an empty workflow", () => {
    const workflow: ExplorerWorkflow = {
      id: "test.empty.workflow",
      name: "Empty",
      description: "Registry work in progress.",
      entryNodeId: "missing",
      nodes: [],
      edges: [],
    };
    expect(layoutWorkflow(workflow)).toEqual({ width: 0, height: 0, nodes: [] });
    expect(layoutWorkflowTree(workflow)).toEqual({ width: 0, height: 0, nodes: [] });
  });

  it("renders a true top-down tree with sibling branches on the same level", () => {
    const workflow: ExplorerWorkflow = {
      id: "test.tree.workflow",
      name: "Tree",
      description: "A visible branch.",
      entryNodeId: "tree.open",
      nodes: [
        {
          id: "tree.open",
          capabilityId: "instagram.messaging",
          name: "Open Instagram",
          description: "Open Instagram.",
          kind: "request",
        },
        {
          id: "tree.profile",
          capabilityId: "instagram.messaging",
          name: "Open profile",
          description: "Open a profile.",
          kind: "operation",
        },
        {
          id: "tree.messages",
          capabilityId: "instagram.messaging",
          name: "Open messages",
          description: "Open messages.",
          kind: "operation",
        },
      ],
      edges: [
        {
          id: "tree.profile-edge",
          from: "tree.open",
          to: "tree.profile",
          kind: "branch",
        },
        {
          id: "tree.messages-edge",
          from: "tree.open",
          to: "tree.messages",
          kind: "branch",
        },
      ],
    };

    const positions = new Map(
      layoutWorkflowTree(workflow).nodes.map((position) => [
        position.node.id,
        position,
      ]),
    );
    const open = positions.get("tree.open")!;
    const profile = positions.get("tree.profile")!;
    const messages = positions.get("tree.messages")!;
    expect(open.y).toBeLessThan(profile.y);
    expect(profile.y).toBe(messages.y);
    expect(profile.x).not.toBe(messages.x);
  });
});
