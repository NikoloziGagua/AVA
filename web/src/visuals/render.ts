import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { FlowVisualMessage, VisualElementKind, VisualScene } from "./types.js";

export type VisualFlowNodeData = Record<string, unknown> & {
  label: string;
  kind: VisualElementKind;
  step: number;
  highlighted: boolean;
  dimmed: boolean;
  targetPosition: Position;
  sourcePosition: Position;
};

export type VisualFlowEdgeData = Record<string, unknown> & {
  highlighted: boolean;
  dimmed: boolean;
};

export type VisualFlowNode = Node<VisualFlowNodeData, "visual">;
export type VisualFlowEdge = Edge<VisualFlowEdgeData, "visual">;

const NODE_WIDTH = 210;
const NODE_HEIGHT = 82;

function layoutDirection(direction: FlowVisualMessage["semanticModel"]["direction"]): "TB" | "BT" | "LR" | "RL" {
  return direction === "TD" ? "TB" : direction;
}

function handlePositions(direction: ReturnType<typeof layoutDirection>): { target: Position; source: Position } {
  if (direction === "LR") return { target: Position.Left, source: Position.Right };
  if (direction === "RL") return { target: Position.Right, source: Position.Left };
  if (direction === "BT") return { target: Position.Bottom, source: Position.Top };
  return { target: Position.Top, source: Position.Bottom };
}

/**
 * Project one storyboard scene into React Flow primitives. VisualMessage remains
 * canonical; Dagre positions a disposable projection and never mutates or
 * persists semantic state.
 */
export function buildSceneFlow(
  visual: FlowVisualMessage,
  scene: VisualScene,
  selectedIds: readonly string[],
  reducedMotion: boolean,
): { nodes: VisualFlowNode[]; edges: VisualFlowEdge[] } {
  const visible = new Set(scene.nodeIds);
  const selected = new Set(selectedIds.filter((id) => visible.has(id)));
  const relationships = visual.semanticModel.relationships.filter(
    (relationship) => visible.has(relationship.from) && visible.has(relationship.to),
  );
  const related = new Set(selected);
  for (const relationship of relationships) {
    if (selected.has(relationship.from) || selected.has(relationship.to)) {
      related.add(relationship.from);
      related.add(relationship.to);
    }
  }

  const rankdir = layoutDirection(visual.semanticModel.direction);
  const positions = handlePositions(rankdir);
  const graph = new dagre.graphlib.Graph({ multigraph: true })
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir,
      ranker: "network-simplex",
      acyclicer: "greedy",
      align: rankdir === "LR" || rankdir === "RL" ? "UL" : undefined,
      nodesep: 46,
      ranksep: 86,
      edgesep: 24,
      marginx: 30,
      marginy: 30,
    });

  for (const element of visual.semanticModel.elements) {
    if (visible.has(element.id)) graph.setNode(element.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const relationship of relationships) {
    graph.setEdge(relationship.from, relationship.to, {}, relationship.id);
  }
  dagre.layout(graph);

  const nodes: VisualFlowNode[] = visual.semanticModel.elements
    .filter((element) => visible.has(element.id))
    .map((element) => {
      const point = graph.node(element.id) as { x: number; y: number };
      const isSelected = selected.has(element.id);
      return {
        id: element.id,
        type: "visual",
        position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
        selected: isSelected,
        draggable: false,
        connectable: false,
        deletable: false,
        focusable: true,
        ariaRole: "button",
        domAttributes: {
          "aria-label": `${element.label}, ${element.kind}${scene.highlightNodeIds.includes(element.id) ? ", highlighted" : ""}`,
          "aria-pressed": isSelected,
          "data-semantic-id": element.id,
        },
        data: {
          label: element.label,
          kind: element.kind,
          step: scene.nodeIds.indexOf(element.id) + 1,
          highlighted: scene.highlightNodeIds.includes(element.id),
          dimmed: selected.size > 0 && !related.has(element.id),
          targetPosition: positions.target,
          sourcePosition: positions.source,
        },
      };
    });

  const edges: VisualFlowEdge[] = relationships.map((relationship) => {
    const isRelated = selected.has(relationship.from) || selected.has(relationship.to);
    const highlighted = relationship.kind === "strong" || isRelated;
    return {
      id: relationship.id,
      source: relationship.from,
      target: relationship.to,
      type: "visual",
      label: relationship.label ?? undefined,
      focusable: true,
      selectable: false,
      animated: !reducedMotion && highlighted,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: highlighted ? "#73f4ff" : "#617784",
      },
      data: {
        highlighted,
        dimmed: selected.size > 0 && !isRelated,
      },
      ariaLabel: `${visual.semanticModel.elements.find((item) => item.id === relationship.from)?.label ?? relationship.from}${relationship.label ? `, ${relationship.label},` : " leads to"} ${visual.semanticModel.elements.find((item) => item.id === relationship.to)?.label ?? relationship.to}`,
    };
  });

  return { nodes, edges };
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ava-visual";
}

function downloadDataUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
}

/** Export the visible native graph. No duplicate artifact is persisted. */
export async function exportVisualCanvas(
  element: HTMLElement,
  format: "svg" | "png",
  title: string,
  sceneTitle: string,
): Promise<void> {
  const { toPng, toSvg } = await import("html-to-image");
  const options = {
    backgroundColor: "#071019",
    cacheBust: false,
    pixelRatio: format === "png" ? 2 : 1,
    skipFonts: true,
    filter: (node: HTMLElement) => !node.classList?.contains("visual-export-ignore"),
  };
  const url = format === "png" ? await toPng(element, options) : await toSvg(element, options);
  downloadDataUrl(url, `${safeFilename(title)}-${safeFilename(sceneTitle)}.${format}`);
}
