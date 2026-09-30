import { useMemo } from "react";
import {
  CheckCircle2,
  CircleStop,
  GitBranch,
  MousePointerClick,
  Play,
  ScanSearch,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  ExplorerWorkflow,
  ExplorerWorkflowEdge,
  ExplorerWorkflowNode,
} from "./types.js";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 88;
const COLUMN_GAP = 82;
const ROW_GAP = 30;
const PADDING = 30;
const TREE_COLUMN_GAP = 42;
const TREE_LEVEL_GAP = 76;
const TREE_RAIL_GUTTER = 48;

export type WorkflowNodePosition = {
  node: ExplorerWorkflowNode;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
};

export type WorkflowLayout = {
  width: number;
  height: number;
  nodes: readonly WorkflowNodePosition[];
};

/**
 * Small deterministic layout for capability workflows. The primary execution
 * graph determines columns; explicit retry edges are rendered, but never pull
 * an earlier operation back into the same rank as its verifier.
 *
 * Registry validation should keep primary workflows acyclic. We still remove a
 * DFS back-edge from any remaining cycle here so malformed or in-progress
 * registry data stays inspectable instead of collapsing into column zero.
 */
export function layoutWorkflow(workflow: ExplorerWorkflow): WorkflowLayout {
  const nodes = [...workflow.nodes];
  if (nodes.length === 0) return { width: 0, height: 0, nodes: [] };

  const nodeIds = new Set(nodes.map((node) => node.id));
  const candidateOutgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of workflow.edges) {
    if (edge.kind === "retry") continue;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    candidateOutgoing.get(edge.from)?.push(edge.to);
  }

  // Keep every non-retry edge except an edge that closes the currently active
  // DFS path. Removing at least one back-edge per cycle leaves a deterministic
  // primary DAG while preserving forward branches and fallbacks.
  const visitState = new Map<string, "visiting" | "visited">();
  const primaryEdges: Array<{ from: string; to: string }> = [];
  const visit = (id: string): void => {
    visitState.set(id, "visiting");
    for (const next of candidateOutgoing.get(id) ?? []) {
      if (visitState.get(next) === "visiting") continue;
      primaryEdges.push({ from: id, to: next });
      if (!visitState.has(next)) visit(next);
    }
    visitState.set(id, "visited");
  };
  if (nodeIds.has(workflow.entryNodeId)) visit(workflow.entryNodeId);
  for (const node of nodes) {
    if (!visitState.has(node.id)) visit(node.id);
  }

  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of primaryEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const level = new Map<string, number>();
  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  if (!queue.length && nodes.length) queue.push(nodes[0]!.id);

  while (queue.length) {
    const id = queue.shift()!;
    const current = level.get(id) ?? 0;
    level.set(id, current);
    for (const next of outgoing.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, current + 1));
      incoming.set(next, Math.max(0, (incoming.get(next) ?? 1) - 1));
      if (incoming.get(next) === 0) queue.push(next);
    }
  }

  // Defense in depth for an invalid edge set or future graph transformation.
  for (const node of nodes) {
    if (!level.has(node.id)) level.set(node.id, 0);
  }

  const maxLevel = Math.max(...level.values());
  const columns = Array.from({ length: maxLevel + 1 }, () => [] as ExplorerWorkflowNode[]);
  for (const node of nodes) columns[level.get(node.id) ?? 0]!.push(node);
  const maxRows = Math.max(...columns.map((column) => column.length), 1);
  const contentHeight = maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;
  const width =
    PADDING * 2 +
    columns.length * NODE_WIDTH +
    Math.max(0, columns.length - 1) * COLUMN_GAP;
  const height = PADDING * 2 + contentHeight;

  const positioned: WorkflowNodePosition[] = [];
  columns.forEach((column, columnIndex) => {
    const columnHeight =
      column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * ROW_GAP;
    const offsetY = PADDING + Math.max(0, (contentHeight - columnHeight) / 2);
    column.forEach((node, rowIndex) => {
      positioned.push({
        node,
        level: columnIndex,
        x: PADDING + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: offsetY + rowIndex * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  });

  return { width, height, nodes: positioned };
}

/**
 * Reuses the validated primary ranks but presents them as a top-down tree:
 * the entry sits at the top and real branches fan out horizontally below it.
 */
export function layoutWorkflowTree(workflow: ExplorerWorkflow): WorkflowLayout {
  const ranked = layoutWorkflow(workflow);
  if (!ranked.nodes.length) return ranked;

  const maxLevel = Math.max(...ranked.nodes.map((position) => position.level));
  const levels = Array.from(
    { length: maxLevel + 1 },
    () => [] as WorkflowNodePosition[],
  );
  for (const position of ranked.nodes) {
    levels[position.level]!.push(position);
  }
  const widest = Math.max(...levels.map((level) => level.length), 1);
  const contentWidth =
    widest * NODE_WIDTH + Math.max(0, widest - 1) * TREE_COLUMN_GAP;
  const width = Math.max(
    PADDING * 2 + contentWidth + TREE_RAIL_GUTTER * 2,
    680,
  );
  const height =
    PADDING * 2 +
    levels.length * NODE_HEIGHT +
    Math.max(0, levels.length - 1) * TREE_LEVEL_GAP;

  const nodes: WorkflowNodePosition[] = [];
  levels.forEach((level, levelIndex) => {
    const rowWidth =
      level.length * NODE_WIDTH +
      Math.max(0, level.length - 1) * TREE_COLUMN_GAP;
    const offsetX = Math.max(PADDING, (width - rowWidth) / 2);
    level.forEach((position, columnIndex) => {
      nodes.push({
        ...position,
        x: offsetX + columnIndex * (NODE_WIDTH + TREE_COLUMN_GAP),
        y: PADDING + levelIndex * (NODE_HEIGHT + TREE_LEVEL_GAP),
      });
    });
  });

  return { width, height, nodes };
}

type EdgeGeometry = {
  path: string;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
};

function edgeGeometry(
  edge: ExplorerWorkflowEdge,
  positions: ReadonlyMap<string, WorkflowNodePosition>,
  orientation: "flow" | "tree",
  layoutWidth: number,
): EdgeGeometry | null {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return null;
  if (orientation === "tree") {
    const x1 = from.x + from.width / 2;
    const x2 = to.x + to.width / 2;
    const downward = to.y >= from.y;
    const y1 = downward ? from.y + from.height : from.y;
    const y2 = downward ? to.y : to.y + to.height;
    const levelDistance = Math.abs(to.level - from.level);
    const useOuterRail =
      levelDistance > 1 ||
      to.level <= from.level ||
      edge.kind === "retry" ||
      edge.kind === "fallback";
    if (useOuterRail) {
      const useRightRail = x2 >= x1;
      const railX = useRightRail
        ? layoutWidth - PADDING
        : PADDING;
      const direction = downward ? 1 : -1;
      const firstTurnY = y1 + direction * 30;
      const lastTurnY = y2 - direction * 30;
      return {
        path:
          `M ${x1} ${y1} ` +
          `C ${x1} ${y1 + direction * 18}, ${railX} ${firstTurnY}, ${railX} ${firstTurnY} ` +
          `L ${railX} ${lastTurnY} ` +
          `C ${railX} ${lastTurnY}, ${x2} ${y2 - direction * 18}, ${x2} ${y2}`,
        labelX: railX + (useRightRail ? -7 : 7),
        labelY: (firstTurnY + lastTurnY) / 2,
        labelAnchor: useRightRail ? "end" : "start",
      };
    }
    const curve = Math.max(30, Math.abs(y2 - y1) * 0.46);
    return {
      path: `M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`,
      // Put sibling labels over their destination cards. Midpoint labels bunch
      // together when one decision fans into two or three adjacent branches.
      labelX: x2,
      labelY: y2 - 18,
      labelAnchor: "middle",
    };
  }
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const curve = Math.max(28, Math.abs(x2 - x1) * 0.44);
  return {
    path: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2 - 7,
    labelAnchor: "middle",
  };
}

const NODE_ICON: Record<ExplorerWorkflowNode["kind"], LucideIcon> = {
  request: Play,
  decision: GitBranch,
  operation: Wrench,
  "external-action": MousePointerClick,
  verification: ScanSearch,
  result: CheckCircle2,
  stop: CircleStop,
};

function nodeTone(
  node: ExplorerWorkflowNode,
  selected: boolean,
  active: boolean,
  executed: boolean,
  failed: boolean,
): { border: string; glow: string; dot: string; label: string } {
  if (failed) {
    return {
      border: "rgba(255,107,107,.68)",
      glow: "0 0 28px -8px rgba(255,107,107,.55)",
      dot: "var(--ac-stop)",
      label: "FAILED",
    };
  }
  if (active) {
    return {
      border: "rgba(92,242,255,.78)",
      glow: "0 0 30px -7px rgba(92,242,255,.75)",
      dot: "var(--ac)",
      label: "ACTIVE",
    };
  }
  if (executed) {
    return {
      border: "rgba(57,255,176,.5)",
      glow: "0 0 24px -10px rgba(57,255,176,.55)",
      dot: "var(--ac-live)",
      label: "OBSERVED",
    };
  }
  return {
    border: selected ? "rgba(92,242,255,.55)" : "rgba(255,255,255,.11)",
    glow: selected ? "0 0 24px -10px rgba(92,242,255,.6)" : "none",
    dot: node.kind === "verification" ? "var(--ac-live)" : "rgba(255,255,255,.35)",
    label: node.kind.replace("-", " ").toUpperCase(),
  };
}

export function WorkflowMap({
  workflow,
  selectedNodeId,
  onSelectNode,
  executedNodeIds = [],
  failedNodeIds = [],
  activeNodeId,
  orientation = "tree",
}: {
  workflow: ExplorerWorkflow;
  selectedNodeId?: string | null;
  onSelectNode?: (node: ExplorerWorkflowNode) => void;
  executedNodeIds?: readonly string[];
  failedNodeIds?: readonly string[];
  activeNodeId?: string | null;
  orientation?: "flow" | "tree";
}) {
  const layout = useMemo(
    () =>
      orientation === "tree"
        ? layoutWorkflowTree(workflow)
        : layoutWorkflow(workflow),
    [orientation, workflow],
  );
  const positions = useMemo(
    () => new Map(layout.nodes.map((position) => [position.node.id, position])),
    [layout.nodes],
  );
  const executed = useMemo(() => new Set(executedNodeIds), [executedNodeIds]);
  const failed = useMemo(() => new Set(failedNodeIds), [failedNodeIds]);
  const svgId = workflow.id.replace(/[^a-zA-Z0-9_-]/g, "-");

  if (!workflow.nodes.length) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-black/30 px-5 py-10 text-center text-xs text-white/40">
        No operational workflow has been defined for this capability yet.
      </div>
    );
  }

  return (
    <div>
      <div className="no-scrollbar overflow-auto rounded-2xl border border-white/[0.08] bg-black/35">
        <div
          className="relative"
          style={{
            width: Math.max(layout.width, 680),
            height: Math.max(layout.height, orientation === "tree" ? 280 : 220),
            background:
              "radial-gradient(circle at 50% 50%, rgba(92,242,255,.045), transparent 54%)," +
              "radial-gradient(circle, rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 24px 24px",
          }}
          role="group"
          aria-label={`${workflow.name} workflow ${orientation}`}
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 ${Math.max(layout.width, 680)} ${Math.max(layout.height, orientation === "tree" ? 280 : 220)}`}
            aria-hidden
          >
            <defs>
              <linearGradient id={`flow-${svgId}`} x1="0" x2="1">
                <stop offset="0" stopColor="rgba(92,242,255,.18)" />
                <stop offset=".55" stopColor="rgba(92,242,255,.65)" />
                <stop offset="1" stopColor="rgba(159,198,212,.38)" />
              </linearGradient>
              <filter id={`glow-${svgId}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker
                id={`arrow-${svgId}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {workflow.edges.map((edge) => {
              const geometry = edgeGeometry(
                edge,
                positions,
                orientation,
                Math.max(layout.width, 680),
              );
              if (!geometry) return null;
              const observed = executed.has(edge.from) && executed.has(edge.to);
              const danger = failed.has(edge.from) || failed.has(edge.to);
              const dashed = edge.kind === "fallback" || edge.kind === "retry" || edge.kind === "branch";
              const labelWidth = Math.min(190, Math.max(46, (edge.label?.length ?? 0) * 5.7 + 14));
              const labelRectX =
                geometry.labelAnchor === "middle"
                  ? geometry.labelX - labelWidth / 2
                  : geometry.labelAnchor === "end"
                    ? geometry.labelX - labelWidth
                    : geometry.labelX;
              return (
                <g key={edge.id}>
                  <path
                    d={geometry.path}
                    fill="none"
                    stroke={
                      danger
                        ? "var(--ac-stop)"
                        : observed
                          ? "var(--ac-live)"
                          : `url(#flow-${svgId})`
                    }
                    strokeWidth={observed || danger ? 2 : 1.3}
                    strokeDasharray={dashed ? "6 7" : undefined}
                    opacity={observed || danger ? 0.9 : 0.62}
                    filter={observed ? `url(#glow-${svgId})` : undefined}
                    markerEnd={`url(#arrow-${svgId})`}
                  />
                  {edge.label && (
                    <>
                      <rect
                        x={labelRectX}
                        y={geometry.labelY - 11}
                        width={labelWidth}
                        height={17}
                        rx={7}
                        fill="rgba(6,9,14,.92)"
                        stroke="rgba(255,255,255,.08)"
                      />
                      <text
                        x={geometry.labelX}
                        y={geometry.labelY}
                        textAnchor={geometry.labelAnchor}
                        fill="rgba(255,255,255,.48)"
                        fontSize="8"
                        fontFamily="var(--font-mono)"
                        letterSpacing=".8"
                      >
                        {edge.label.toUpperCase()}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {layout.nodes.map((position) => {
            const { node } = position;
            const Icon = NODE_ICON[node.kind];
            const isSelected = selectedNodeId === node.id;
            const isActive = activeNodeId === node.id;
            const wasExecuted = executed.has(node.id);
            const didFail = failed.has(node.id);
            const tone = nodeTone(node, isSelected, isActive, wasExecuted, didFail);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode?.(node)}
                className="absolute overflow-hidden rounded-2xl px-4 py-3 text-left transition-[border-color,background,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
                style={{
                  left: position.x,
                  top: position.y,
                  width: position.width,
                  height: position.height,
                  border: `1px solid ${tone.border}`,
                  boxShadow: tone.glow,
                  background: isSelected
                    ? "linear-gradient(145deg,rgba(92,242,255,.12),rgba(8,11,17,.94))"
                    : "linear-gradient(145deg,rgba(255,255,255,.055),rgba(8,11,17,.92))",
                }}
                aria-pressed={isSelected}
              >
                <div className="flex items-center gap-2">
                  <Icon size={13} style={{ color: tone.dot }} />
                  <span className="hud truncate text-[8px]" style={{ color: tone.dot }}>
                    {tone.label}
                  </span>
                </div>
                <div className="mt-2 line-clamp-2 text-[12px] font-semibold leading-snug text-white/85">
                  {node.name}
                </div>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute right-3 top-3 h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ background: "var(--ac)", boxShadow: "0 0 10px var(--ac)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[9px] text-white/35">
        <span className="hud">
          {orientation === "tree" ? "Top-down capability tree" : "Left-to-right execution flow"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ac-live)]" /> Observed route
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 border-t border-dashed border-white/40" /> Branch or fallback
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ac-stop)]" /> Failure
        </span>
      </div>
    </div>
  );
}
