import { memo, forwardRef, useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  ReactFlow,
  getSmoothStepPath,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleCheck, GitBranch, Route } from "lucide-react";
import { buildSceneFlow, type VisualFlowEdge, type VisualFlowNode } from "./render.js";
import type { VisualMessage, VisualScene } from "./types.js";

export type VisualFlowCanvasProps = {
  visual: VisualMessage;
  scene: VisualScene;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  reducedMotion: boolean;
  expanded: boolean;
};

const NODE_KIND = {
  process: { label: "Process", icon: Route },
  decision: { label: "Decision", icon: GitBranch },
  terminal: { label: "Milestone", icon: CircleCheck },
} as const;

const VisualNode = memo(function VisualNode({ data, selected }: NodeProps<VisualFlowNode>) {
  const detail = NODE_KIND[data.kind];
  const Icon = detail.icon;
  return (
    <div
      className={`visual-flow-node visual-flow-node--${data.kind}${data.highlighted ? " is-highlighted" : ""}${selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}`}
      data-testid={`visual-node-${data.step}`}
    >
      <Handle type="target" position={data.targetPosition} isConnectable={false} className="visual-flow-handle" />
      <span className="visual-flow-node__step">{String(data.step).padStart(2, "0")}</span>
      <span className="visual-flow-node__icon" aria-hidden="true"><Icon size={15} /></span>
      <span className="visual-flow-node__content">
        <span className="visual-flow-node__kind">{detail.label}</span>
        <span className="visual-flow-node__label">{data.label}</span>
      </span>
      {data.highlighted && <span className="visual-flow-node__pulse" aria-hidden="true" />}
      <Handle type="source" position={data.sourcePosition} isConnectable={false} className="visual-flow-handle" />
    </div>
  );
});

const VisualEdge = memo(function VisualEdge(props: EdgeProps<VisualFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 18,
    offset: 22,
  });
  const highlighted = props.data?.highlighted === true;
  const dimmed = props.data?.dimmed === true;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        className={`${highlighted ? "visual-flow-edge is-highlighted" : "visual-flow-edge"}${dimmed ? " is-dimmed" : ""}`}
        style={props.style}
      />
      {props.label && (
        <EdgeLabelRenderer>
          <span
            className={`visual-flow-edge__label nodrag nopan${highlighted ? " is-highlighted" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {String(props.label)}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { visual: VisualNode };
const edgeTypes = { visual: VisualEdge };

export const VisualFlowCanvas = forwardRef<HTMLDivElement, VisualFlowCanvasProps>(function VisualFlowCanvas({
  visual,
  scene,
  selectedIds,
  onSelectedIdsChange,
  reducedMotion,
  expanded,
}, ref) {
  const graph = useMemo(
    () => buildSceneFlow(visual, scene, selectedIds, reducedMotion),
    [reducedMotion, scene, selectedIds, visual],
  );
  const showMiniMap = expanded || graph.nodes.length > 6;
  const updateSelection = useCallback((ids: string[]) => {
    if (ids.length === selectedIds.length && ids.every((id, index) => id === selectedIds[index])) return;
    onSelectedIdsChange(ids);
  }, [onSelectedIdsChange, selectedIds]);

  return (
    <div ref={ref} className="visual-flow-canvas" data-testid="visual-flow-canvas">
      <ReactFlow<VisualFlowNode, VisualFlowEdge>
        key={`${visual.visualMessageId}:${visual.revision}:${scene.id}:${expanded ? "expanded" : "inline"}`}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: expanded ? 0.16 : 0.28, duration: reducedMotion ? 0 : 420 }}
        minZoom={0.32}
        maxZoom={2.4}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        selectionOnDrag={false}
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={["Meta", "Control"]}
        panOnDrag
        panOnScroll={expanded}
        zoomOnPinch
        zoomOnScroll={expanded}
        zoomOnDoubleClick={false}
        preventScrolling={expanded}
        autoPanOnNodeFocus
        onlyRenderVisibleElements={graph.nodes.length > 20}
        onNodeClick={(_, node) => updateSelection([node.id])}
        onSelectionChange={({ nodes }) => updateSelection(nodes.map((node) => node.id))}
        onPaneClick={() => updateSelection([])}
        aria-label={`${visual.title}, ${scene.title} interactive workflow`}
        ariaLabelConfig={{
          "node.a11yDescription.default": "Press Enter or Space to select this step. Press Escape to clear selection.",
          "edge.a11yDescription.default": "Workflow relationship.",
          "controls.ariaLabel": "Diagram view controls",
          "controls.fitView.ariaLabel": "Fit workflow to view",
        }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(125, 225, 235, 0.13)" />
        <Controls
          className="visual-flow-controls visual-export-ignore"
          showInteractive={false}
          position="bottom-left"
          fitViewOptions={{ padding: expanded ? 0.16 : 0.28, duration: reducedMotion ? 0 : 420 }}
        />
        {showMiniMap && (
          <MiniMap
            className="visual-flow-minimap visual-export-ignore"
            pannable
            zoomable
            position="bottom-right"
            maskColor="rgba(3, 8, 13, 0.72)"
            nodeColor={(node) => node.selected ? "#73f4ff" : node.data.highlighted ? "#36d7e8" : "#405d68"}
            nodeStrokeColor="#091217"
          />
        )}
        <div className="visual-flow-legend visual-export-ignore" aria-hidden="true">
          <span><i className="is-process" /> Process</span>
          <span><i className="is-decision" /> Decision</span>
          <span><i className="is-terminal" /> Milestone</span>
        </div>
      </ReactFlow>
    </div>
  );
});
