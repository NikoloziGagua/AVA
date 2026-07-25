import { describe, expect, it } from "vitest";
import {
  CAPABILITY_BY_ID,
  EXPLORER_CAPABILITIES,
  EXPLORER_DOMAINS,
  EXPLORER_REGISTRY,
  getCapability,
  getChildCapabilities,
  getDomainCapabilities,
  validateExplorerRegistry,
} from "./registry.js";
import type { ExplorerRegistry } from "./types.js";

const mutableRegistry = (): {
  domains: Array<(typeof EXPLORER_DOMAINS)[number]>;
  capabilities: Array<(typeof EXPLORER_CAPABILITIES)[number]>;
} => ({
  domains: [...EXPLORER_DOMAINS],
  capabilities: [...EXPLORER_CAPABILITIES],
});

describe("Explorer capability registry", () => {
  it("is internally consistent", () => {
    expect(validateExplorerRegistry()).toEqual([]);
  });

  it("gives every domain a stable unique identity and at least one capability", () => {
    expect(new Set(EXPLORER_DOMAINS.map((domain) => domain.id)).size).toBe(EXPLORER_DOMAINS.length);
    expect(new Set(EXPLORER_DOMAINS.map((domain) => domain.order)).size).toBe(EXPLORER_DOMAINS.length);

    for (const domain of EXPLORER_DOMAINS) {
      expect(getDomainCapabilities(domain.id).length, domain.id).toBeGreaterThan(0);
    }
  });

  it("indexes every capability without creating a second source of truth", () => {
    expect(CAPABILITY_BY_ID.size).toBe(EXPLORER_CAPABILITIES.length);
    for (const capability of EXPLORER_CAPABILITIES) {
      expect(getCapability(capability.id)).toBe(capability);
      expect(CAPABILITY_BY_ID.get(capability.id)).toBe(capability);
    }
    expect(getCapability("not.a.real-capability")).toBeUndefined();
  });

  it("models parent-child depth only inside a domain", () => {
    expect(getChildCapabilities("instagram.messaging").map((item) => item.id)).toEqual([
      "instagram.connection",
      "instagram.send-dm",
    ]);
    expect(getChildCapabilities("whatsapp.messaging").map((item) => item.id)).toEqual([
      "whatsapp.connection",
      "whatsapp.send-message",
    ]);

    for (const capability of EXPLORER_CAPABILITIES) {
      if (!capability.parentId) continue;
      expect(getCapability(capability.parentId)?.domainId).toBe(capability.domainId);
    }
  });

  it("keeps current readiness out of static capability definitions", () => {
    for (const capability of EXPLORER_CAPABILITIES) {
      const staticKeys = Object.keys(capability);
      expect(staticKeys).not.toContain("status");
      expect(staticKeys).not.toContain("ready");
      expect(staticKeys).not.toContain("health");

      const dimensions = new Set(capability.readiness.map((item) => item.dimension));
      expect(dimensions.has("defined"), capability.id).toBe(true);
      expect(capability.runtime?.snapshot?.every((binding) => binding.path.length > 0) ?? true).toBe(true);
    }
  });

  it("links runtime snapshot paths and tools without claiming their observed value", () => {
    const browser = getCapability("browser.persistent-control")!;
    expect(browser.runtime?.snapshot?.map((binding) => binding.path)).toEqual([
      "core.browser.ready",
      "core.browser.mode",
    ]);
    expect(browser.runtime?.toolNames).toContain("chrome_open");
    expect(browser.runtime?.toolNames).toContain("chrome_snapshot");

    const instagram = getCapability("instagram.messaging")!;
    expect(instagram.runtime?.snapshot?.[0]?.note).toMatch(/browser readiness/i);
    expect(instagram.readiness.map((item) => item.dimension)).toContain("authenticated");
  });

  it("uses globally unique workflow, node and edge IDs with valid local graph references", () => {
    const workflowIds: string[] = [];
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];

    for (const capability of EXPLORER_CAPABILITIES) {
      const workflow = capability.workflow;
      if (!workflow) continue;
      workflowIds.push(workflow.id);
      nodeIds.push(...workflow.nodes.map((node) => node.id));
      edgeIds.push(...workflow.edges.map((edge) => edge.id));

      const localNodes = new Set(workflow.nodes.map((node) => node.id));
      expect(localNodes.has(workflow.entryNodeId), workflow.id).toBe(true);
      for (const edge of workflow.edges) {
        expect(localNodes.has(edge.from), `${workflow.id}: ${edge.id} from`).toBe(true);
        expect(localNodes.has(edge.to), `${workflow.id}: ${edge.id} to`).toBe(true);
      }
    }

    expect(new Set(workflowIds).size).toBe(workflowIds.length);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it("gives every capability a substantive operational workflow", () => {
    expect(EXPLORER_CAPABILITIES).toHaveLength(29);
    for (const capability of EXPLORER_CAPABILITIES) {
      const workflow = capability.workflow;
      expect(workflow, capability.id).toBeDefined();
      expect(workflow!.id, capability.id).toBe(`${capability.id}.workflow`);
      expect(workflow!.nodes.length, capability.id).toBeGreaterThanOrEqual(4);
      expect(workflow!.edges.length, capability.id).toBeGreaterThanOrEqual(3);
      expect(
        workflow!.nodes.some((node) =>
          node.kind === "operation" ||
          node.kind === "external-action" ||
          node.kind === "decision" ||
          node.kind === "verification"
        ),
        capability.id,
      ).toBe(true);
    }
  });

  it("models the Instagram and WhatsApp trees down to identity and send verification", () => {
    const instagram = getCapability("instagram.messaging")!.workflow!;
    const instagramTools = new Set(instagram.nodes.map((node) => node.toolName).filter(Boolean));
    expect(instagramTools.has("instagram_status")).toBe(true);
    expect(instagramTools.has("instagram_open_profile")).toBe(true);
    expect(instagramTools.has("instagram_open_chat")).toBe(true);
    expect(instagramTools.has("instagram_read_chat")).toBe(true);
    expect(instagramTools.has("instagram_send_dm")).toBe(true);
    expect(instagram.nodes.find((node) => node.id === "instagram.messaging.open")?.name).toBe(
      "Open Instagram",
    );
    expect(instagram.nodes.find((node) => node.id === "instagram.messaging.profile")?.name).toBe(
      "Open profile",
    );
    expect(instagram.nodes.find((node) => node.id === "instagram.messaging.messages")?.name).toBe(
      "Open messages",
    );
    expect(
      instagram.edges.filter(
        (edge) => edge.from === "instagram.messaging.surface" && edge.kind === "branch",
      ).map((edge) => edge.to),
    ).toEqual([
      "instagram.messaging.profile",
      "instagram.messaging.messages",
    ]);
    expect(
      instagram.nodes.find((node) => node.id === "instagram.messaging.verify-send")?.parentNodeId,
    ).toBe("instagram.messaging.send");
    expect(instagram.edges.some((edge) => edge.kind === "branch")).toBe(true);
    expect(instagram.edges.some((edge) => edge.kind === "stop")).toBe(true);

    const whatsapp = getCapability("whatsapp.messaging")!.workflow!;
    const whatsappTools = new Set(whatsapp.nodes.map((node) => node.toolName).filter(Boolean));
    expect(whatsappTools.has("whatsapp_status")).toBe(true);
    expect(whatsappTools.has("whatsapp_open_chat")).toBe(true);
    expect(whatsappTools.has("whatsapp_read_chat")).toBe(true);
    expect(whatsappTools.has("whatsapp_send_message")).toBe(true);
    expect(
      whatsapp.nodes.find((node) => node.id === "whatsapp.messaging.verify-header")?.description,
    ).toMatch(/conversation pane/i);
  });

  it("keeps every nested workflow node inside its own workflow without parent cycles", () => {
    let nestedNodes = 0;
    for (const capability of EXPLORER_CAPABILITIES) {
      const workflow = capability.workflow!;
      const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
      for (const node of workflow.nodes) {
        if (!node.parentNodeId) continue;
        nestedNodes += 1;
        expect(byId.has(node.parentNodeId), `${workflow.id}: ${node.id}`).toBe(true);
        const ancestors = new Set([node.id]);
        let parentId: string | undefined = node.parentNodeId;
        while (parentId) {
          expect(ancestors.has(parentId), `${workflow.id}: ${node.id} hierarchy cycle`).toBe(false);
          ancestors.add(parentId);
          parentId = byId.get(parentId)?.parentNodeId;
        }
      }
    }
    expect(nestedNodes).toBeGreaterThan(100);
  });

  it("rejects duplicate IDs, broken references and hierarchy cycles", () => {
    const duplicate = mutableRegistry();
    duplicate.capabilities.push(duplicate.capabilities[0]!);
    expect(validateExplorerRegistry(duplicate as ExplorerRegistry).map((issue) => issue.code)).toContain(
      "duplicate-capability-id",
    );

    const missingDependency = mutableRegistry();
    missingDependency.capabilities[0] = {
      ...missingDependency.capabilities[0]!,
      dependencies: [
        ...missingDependency.capabilities[0]!.dependencies,
        {
          targetType: "capability",
          targetId: "missing.capability",
          relationship: "depends-on",
          required: true,
          description: "Intentional test fixture.",
        },
      ],
    };
    expect(
      validateExplorerRegistry(missingDependency as ExplorerRegistry).map((issue) => issue.code),
    ).toContain("unknown-capability-dependency");

    const cycle = mutableRegistry();
    const instagramRoot = cycle.capabilities.findIndex((item) => item.id === "instagram.messaging");
    cycle.capabilities[instagramRoot] = {
      ...cycle.capabilities[instagramRoot]!,
      parentId: "instagram.connection",
    };
    expect(validateExplorerRegistry(cycle as ExplorerRegistry).map((issue) => issue.code)).toContain(
      "cyclic-hierarchy",
    );
  });

  it("rejects a missing workflow and invalid nested workflow hierarchy", () => {
    const missing = mutableRegistry();
    missing.capabilities[0] = { ...missing.capabilities[0]!, workflow: undefined };
    expect(validateExplorerRegistry(missing as ExplorerRegistry).map((issue) => issue.code)).toContain(
      "missing-workflow",
    );

    const brokenParent = mutableRegistry();
    const first = brokenParent.capabilities[0]!;
    const workflow = first.workflow!;
    brokenParent.capabilities[0] = {
      ...first,
      workflow: {
        ...workflow,
        nodes: workflow.nodes.map((node, index) =>
          index === 0 ? { ...node, parentNodeId: "missing.parent" } : node,
        ),
      },
    };
    expect(
      validateExplorerRegistry(brokenParent as ExplorerRegistry).map((issue) => issue.code),
    ).toContain("unknown-workflow-node-parent");

    const nestedCycle = mutableRegistry();
    const cycleCapability = nestedCycle.capabilities.find(
      (capability) => capability.id === "instagram.messaging",
    )!;
    const cycleWorkflow = cycleCapability.workflow!;
    const profileId = "instagram.messaging.profile";
    const resolveId = "instagram.messaging.profile-resolve";
    const cycleIndex = nestedCycle.capabilities.indexOf(cycleCapability);
    nestedCycle.capabilities[cycleIndex] = {
      ...cycleCapability,
      workflow: {
        ...cycleWorkflow,
        nodes: cycleWorkflow.nodes.map((node) => {
          if (node.id === profileId) return { ...node, parentNodeId: resolveId };
          return node;
        }),
      },
    };
    expect(
      validateExplorerRegistry(nestedCycle as ExplorerRegistry).map((issue) => issue.code),
    ).toContain("cyclic-workflow-node-hierarchy");
  });

  it("rejects malformed workflow edges and unreachable nodes", () => {
    const broken = mutableRegistry();
    const browserIndex = broken.capabilities.findIndex((item) => item.id === "browser.persistent-control");
    const browser = broken.capabilities[browserIndex]!;
    const workflow = browser.workflow!;
    broken.capabilities[browserIndex] = {
      ...browser,
      workflow: {
        ...workflow,
        nodes: [
          ...workflow.nodes,
          {
            id: "browser.persistent-control.orphan",
            capabilityId: browser.id,
            name: "Orphan",
            description: "Intentional unreachable test fixture.",
            kind: "operation",
          },
        ],
        edges: [
          ...workflow.edges,
          {
            id: "browser.persistent-control.broken-edge",
            from: workflow.entryNodeId,
            to: "browser.persistent-control.missing",
            kind: "next",
          },
        ],
      },
    };

    const codes = validateExplorerRegistry(broken as ExplorerRegistry).map((issue) => issue.code);
    expect(codes).toContain("unknown-workflow-edge-node");
    expect(codes).toContain("unreachable-workflow-node");
  });

  it("requires repository-relative source references and definition evidence", () => {
    const broken = mutableRegistry();
    broken.capabilities[0] = {
      ...broken.capabilities[0]!,
      definition: {
        ...broken.capabilities[0]!.definition,
        sourceReferences: [
          {
            path: "C:\\private\\implementation.ts",
            symbol: "bad",
            kind: "implementation",
          },
        ],
      },
      readiness: broken.capabilities[0]!.readiness.filter((item) => item.dimension !== "defined"),
    };

    const codes = validateExplorerRegistry(broken as ExplorerRegistry).map((issue) => issue.code);
    expect(codes).toContain("invalid-source-path");
    expect(codes).toContain("missing-defined-readiness");
  });

  it("exports the canonical arrays through one registry object", () => {
    expect(EXPLORER_REGISTRY.domains).toBe(EXPLORER_DOMAINS);
    expect(EXPLORER_REGISTRY.capabilities).toBe(EXPLORER_CAPABILITIES);
  });
});
