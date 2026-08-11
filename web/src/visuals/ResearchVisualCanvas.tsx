import { forwardRef, useEffect, useMemo, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/land-110m.json";
import { VisualFlowCanvas } from "./VisualFlowCanvas.js";
import type {
  FlowVisualMessage,
  ResearchScene,
  ResearchVisualMessage,
  VisualScene,
} from "./types.js";

type Props = {
  visual: ResearchVisualMessage;
  scene: ResearchScene;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  reducedMotion: boolean;
  expanded: boolean;
};

const COLORS = {
  cyan: "#63e6f0", purple: "#a78bfa", amber: "#f4c76b", green: "#73d69a", red: "#ff7c86", grey: "#8195a2",
} as const;

function toggleSelection(id: string, current: string[], change: (ids: string[]) => void) {
  change(current.includes(id) ? current.filter((item) => item !== id) : [id]);
}

function activateOnKey(event: React.KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
}

function EvidenceDot({ status, confidence }: { status: string; confidence: string }) {
  const color = status === "gap" ? "#6f7d86" : status === "disputed" || status === "counterevidence" ? "#f4c76b" : confidence === "low" || confidence === "unknown" ? "#9b8bb8" : "#63e6f0";
  return <span aria-label={`${status}, ${confidence} confidence`} title={`${status} · ${confidence} confidence`} className="inline-block h-2.5 w-2.5 rounded-full border border-black/40" style={{ background: color }} />;
}

function GeographicCanvas(props: Props) {
  const model = props.visual.semanticModel;
  if (model.kind !== "geographic_map") return null;
  const width = 960;
  const height = props.expanded ? 590 : 430;
  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[22, 24], [width - 22, height - 34]], { type: "Sphere" }), [height]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const land = useMemo(() => feature(world as any, (world as any).objects.land) as unknown as GeoPermissibleObjects, []);
  const [layerId, setLayerId] = useState<string>(model.timeLayers[0]?.id ?? "");
  const layer = model.timeLayers.find((item) => item.id === layerId) ?? model.timeLayers[0];
  useEffect(() => {
    const sceneIds = new Set(props.scene.entityIds);
    const bestLayer = model.timeLayers
      .map((item) => ({ item, matches: item.entityIds.filter((id) => sceneIds.has(id)).length }))
      .sort((a, b) => b.matches - a.matches)[0];
    if (bestLayer?.matches) setLayerId(bestLayer.item.id);
  }, [model.timeLayers, props.scene.id, props.scene.entityIds]);
  const sceneIds = new Set(props.scene.entityIds);
  const layerIds = new Set(layer?.entityIds ?? props.scene.entityIds);
  const visible = (id: string) => sceneIds.has(id) && layerIds.has(id);
  const locations = model.locations.filter((item) => visible(item.id));
  const byId = new Map(model.locations.map((item) => [item.id, item]));
  const routes = model.routes.filter((item) => visible(item.id) && byId.has(item.from) && byId.has(item.to));
  const regions = model.regions.filter((item) => visible(item.id));
  const selected = new Set(props.selectedIds);
  const highlighted = new Set(props.scene.highlightEntityIds);
  const markerId = `research-arrow-${props.visual.visualMessageId}-${props.scene.id}-${props.expanded ? "expanded" : "inline"}`;
  const glowId = `research-glow-${props.visual.visualMessageId}-${props.scene.id}-${props.expanded ? "expanded" : "inline"}`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(17,65,77,.35),transparent_58%)]" data-testid="research-map-canvas">
      {model.timeLayers.length > 1 && (
        <div className="visual-export-ignore absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] gap-1 overflow-x-auto rounded-lg border border-white/10 bg-black/65 p-1 backdrop-blur" aria-label="Map time layers">
          {model.timeLayers.map((item) => <button key={item.id} type="button" onClick={() => setLayerId(item.id)} aria-pressed={item.id === layer?.id} className={`min-w-max rounded-md px-2.5 py-1.5 text-[10px] ${item.id === layer?.id ? "bg-cyan-300/15 text-cyan-50" : "text-white/45 hover:text-white/75"}`}>{item.label} · {item.period}</button>)}
        </div>
      )}
      <div className={`absolute right-3 z-10 max-w-[46%] rounded-lg border border-white/10 bg-black/65 p-2 text-[9px] leading-4 text-white/55 backdrop-blur ${model.timeLayers.length > 1 ? "top-14" : "top-3"}`} aria-label="Map legend">
        {model.legend.map((item) => <div key={item.id}><strong className="text-white/75">{item.label}:</strong> {item.meaning}</div>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${props.visual.title}, geographic map, ${layer?.period ?? "all periods"}`} className="h-full w-full">
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#63e6f0" /></marker>
          <filter id={glowId}><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <path d={path({ type: "Sphere" }) ?? ""} fill="#07131b" stroke="#35515e" strokeWidth="1.4" />
        <path d={path(geoGraticule10()) ?? ""} fill="none" stroke="#24404c" strokeWidth="0.7" opacity="0.55" />
        <path d={path(land) ?? ""} fill="#152a31" stroke="#59717a" strokeWidth="0.65" />
        {regions.map((region) => {
          const [west, south, east, north] = region.bounds;
          const polygon = { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } as GeoPermissibleObjects;
          const centre = projection([(west + east) / 2, (south + north) / 2]);
          return <g key={region.id}><path d={path(polygon) ?? ""} fill={selected.has(region.id) ? "rgba(99,230,240,.28)" : "rgba(167,139,250,.13)"} stroke="#a78bfa" strokeDasharray={region.confidence === "low" || region.confidence === "unknown" ? "6 5" : undefined} strokeWidth={selected.has(region.id) ? 2.4 : 1.2} role="button" tabIndex={0} aria-label={`${region.label}, approximate region, ${region.confidence} confidence`} onClick={() => toggleSelection(region.id, props.selectedIds, props.onSelectedIdsChange)} onKeyDown={(event) => activateOnKey(event, () => toggleSelection(region.id, props.selectedIds, props.onSelectedIdsChange))} />{centre && <text x={centre[0]} y={centre[1]} textAnchor="middle" fill="#dccfff" stroke="#061016" strokeWidth="3" paintOrder="stroke" fontSize="11">{region.label}</text>}</g>;
        })}
        {routes.map((route) => {
          const from = byId.get(route.from)!;
          const to = byId.get(route.to)!;
          const geometry = { type: "LineString", coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] } as GeoPermissibleObjects;
          const active = selected.has(route.id) || highlighted.has(route.id);
          return <path key={route.id} d={path(geometry) ?? ""} fill="none" stroke={route.evidenceStatus === "disputed" ? "#f4c76b" : "#63e6f0"} strokeWidth={active ? 4 : 2.2} strokeDasharray={route.direction === "unknown" || route.confidence === "low" ? "7 6" : undefined} opacity={props.selectedIds.length && !selected.has(route.id) ? 0.42 : 0.9} markerStart={route.direction === "bidirectional" ? `url(#${markerId})` : undefined} markerEnd={route.direction === "forward" || route.direction === "bidirectional" ? `url(#${markerId})` : undefined} role="button" tabIndex={0} aria-label={`${route.label}, ${route.direction} route, ${route.confidence} confidence`} onClick={() => toggleSelection(route.id, props.selectedIds, props.onSelectedIdsChange)} onKeyDown={(event) => activateOnKey(event, () => toggleSelection(route.id, props.selectedIds, props.onSelectedIdsChange))} />;
        })}
        {locations.map((location) => {
          const point = projection([location.longitude, location.latitude]);
          if (!point) return null;
          const active = selected.has(location.id) || highlighted.has(location.id);
          const radius = location.coordinatePrecision === "regional" ? 11 : location.coordinatePrecision === "approximate" ? 8 : 6;
          return <g key={location.id} transform={`translate(${point[0]},${point[1]})`} role="button" tabIndex={0} aria-label={`${location.label}, ${location.coordinatePrecision} location, ${location.confidence} confidence`} className="cursor-pointer outline-none" onClick={() => toggleSelection(location.id, props.selectedIds, props.onSelectedIdsChange)} onKeyDown={(event) => activateOnKey(event, () => toggleSelection(location.id, props.selectedIds, props.onSelectedIdsChange))}>
            {location.uncertaintyKm !== null && location.uncertaintyKm > 0 && <circle r={Math.min(34, 7 + Math.sqrt(location.uncertaintyKm) / 2)} fill="rgba(244,199,107,.08)" stroke="#f4c76b" strokeDasharray="3 3" />}
            <circle r={radius} fill={location.evidenceStatus === "disputed" ? "#f4c76b" : "#63e6f0"} stroke="#031016" strokeWidth="3" opacity={active ? 1 : 0.82} filter={active ? `url(#${glowId})` : undefined} />
            <text y={-radius - 7} textAnchor="middle" fill="#e7fbff" stroke="#031016" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="600">{location.label}</text>
          </g>;
        })}
      </svg>
      <div className="visual-export-ignore absolute bottom-2 left-2 right-2 flex flex-wrap items-end justify-between gap-2 text-[9px] text-white/45">
        <div className="rounded-md border border-white/10 bg-black/60 px-2 py-1.5">Solid = sourced · dashed = uncertain/disputed · halo = geographic uncertainty</div>
        <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer" className="rounded-md bg-black/60 px-2 py-1.5 hover:text-cyan-100">Basemap: Natural Earth (public domain)</a>
      </div>
    </div>
  );
}

function TimelineCanvas(props: Props) {
  const model = props.visual.semanticModel;
  if (model.kind !== "timeline") return null;
  const visible = model.events.filter((item) => props.scene.entityIds.includes(item.id)).sort((a, b) => (a.startYear ?? Number.MAX_SAFE_INTEGER) - (b.startYear ?? Number.MAX_SAFE_INTEGER));
  return <div className="h-full overflow-auto p-5 sm:p-8" data-testid="research-timeline-canvas"><div className="relative mx-auto max-w-4xl border-l border-cyan-300/25 pl-7 sm:pl-10">
    {visible.map((event, index) => <button key={event.id} type="button" onClick={() => toggleSelection(event.id, props.selectedIds, props.onSelectedIdsChange)} className={`relative mb-5 block w-full rounded-xl border p-4 text-left ${props.selectedIds.includes(event.id) ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.025] hover:border-white/25"}`}>
      <span className="absolute -left-[35px] top-5 h-3.5 w-3.5 rounded-full border-2 border-[#071019] bg-cyan-300 sm:-left-[47px]" />
      <span className="hud text-[9px] text-cyan-100/55">{String(index + 1).padStart(2, "0")} · {event.dateLabel} · {event.datePrecision}</span>
      <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-white/90"><EvidenceDot status={event.evidenceStatus} confidence={event.confidence} /> {event.label}</span>
      <span className="mt-1 block text-xs leading-5 text-white/50">{event.description}</span>
      {event.uncertainty && <span className="mt-2 block text-[10px] text-amber-100/60">Uncertainty: {event.uncertainty}</span>}
    </button>)}
  </div></div>;
}

function MatrixCanvas(props: Props) {
  const model = props.visual.semanticModel;
  if (model.kind !== "evidence_matrix") return null;
  const sceneCells = new Map(model.cells.filter((cell) => props.scene.entityIds.includes(cell.id)).map((cell) => [`${cell.rowId}:${cell.columnId}`, cell]));
  const color = { strong: "bg-emerald-300/18 text-emerald-50", moderate: "bg-cyan-300/13 text-cyan-50", weak: "bg-amber-300/12 text-amber-50", missing: "bg-white/[0.025] text-white/35", disputed: "bg-purple-300/14 text-purple-50" } as const;
  return <div className="h-full overflow-auto p-4" data-testid="research-matrix-canvas"><table className="min-w-full border-separate border-spacing-1 text-left text-xs"><caption className="sr-only">Evidence coverage matrix</caption><thead><tr><th className="p-2 text-white/35">Area</th>{model.columns.map((column) => <th key={column.id} className="min-w-32 p-2 text-white/60">{column.label}</th>)}</tr></thead><tbody>{model.rows.map((row) => <tr key={row.id}><th className="p-2 text-white/65">{row.label}</th>{model.columns.map((column) => { const cell = sceneCells.get(`${row.id}:${column.id}`); return <td key={column.id} className="align-top">{cell ? <button type="button" onClick={() => toggleSelection(cell.id, props.selectedIds, props.onSelectedIdsChange)} className={`h-full min-h-24 w-full rounded-lg border p-3 text-left ${color[cell.coverage]} ${props.selectedIds.includes(cell.id) ? "border-white/60" : "border-white/8"}`}><span className="hud text-[8px]">{cell.coverage}</span><span className="mt-1 block font-medium">{cell.label}</span><span className="mt-1 block text-[10px] leading-4 opacity-65">{cell.detail}</span></button> : <span className="block min-h-24 rounded-lg border border-dashed border-white/5 bg-white/[0.01]" aria-label="Not included in this scene" />}</td>; })}</tr>)}</tbody></table></div>;
}

function ChartCanvas(props: Props) {
  const model = props.visual.semanticModel;
  if (model.kind !== "chart") return null;
  const points = model.points.filter((point) => props.scene.entityIds.includes(point.id));
  const numeric = points.flatMap((point) => [point.value, point.low, point.high]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const min = model.zeroBaseline ? Math.min(0, ...numeric) : Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min || 1;
  const width = 900; const height = 400; const left = 72; const bottom = 55; const top = 25; const plotHeight = height - top - bottom;
  const y = (value: number) => top + (max - value) / range * plotHeight;
  const slot = (width - left - 24) / Math.max(1, points.length);
  const series = new Map(model.series.map((item) => [item.id, item]));
  return <div className="h-full w-full p-2" data-testid="research-chart-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${props.visual.title}, ${model.chartType} chart`} className="h-full w-full">
    {[0, .25, .5, .75, 1].map((part) => { const value = min + range * part; return <g key={part}><line x1={left} x2={width - 12} y1={y(value)} y2={y(value)} stroke="#1d3944" /><text x={left - 8} y={y(value) + 4} fill="#78909a" fontSize="11" textAnchor="end">{Number(value.toPrecision(4))}</text></g>; })}
    {points.map((point, index) => {
      const value = point.value; const color = COLORS[series.get(point.seriesId)?.colorHint ?? "cyan"]; const x = left + index * slot + slot / 2; const active = props.selectedIds.includes(point.id);
      return <g key={point.id} role="button" tabIndex={0} aria-label={`${point.label}, ${value === null ? "value unavailable" : `${value} ${model.unit}`}, ${point.confidence} confidence`} onClick={() => toggleSelection(point.id, props.selectedIds, props.onSelectedIdsChange)} onKeyDown={(event) => activateOnKey(event, () => toggleSelection(point.id, props.selectedIds, props.onSelectedIdsChange))} className="cursor-pointer">
        {value === null ? <path d={`M${x - 8},${height / 2} l16,16 m0,-16 l-16,16`} stroke="#697982" strokeWidth="3" /> : model.chartType === "bar" ? <rect x={x - slot * .3} y={Math.min(y(value), y(0))} width={slot * .6} height={Math.abs(y(value) - y(0))} rx="6" fill={color} opacity={active ? 1 : .72} stroke={active ? "white" : "none"} /> : <circle cx={x} cy={y(value)} r={active ? 8 : 5} fill={color} stroke="#071019" strokeWidth="2" />}
        {point.low !== null && point.high !== null && <><line x1={x} x2={x} y1={y(point.low)} y2={y(point.high)} stroke={color} strokeWidth="2" /><line x1={x - 6} x2={x + 6} y1={y(point.low)} y2={y(point.low)} stroke={color} /><line x1={x - 6} x2={x + 6} y1={y(point.high)} y2={y(point.high)} stroke={color} /></>}
        <text x={x} y={height - 27} fill="#a9bbc2" fontSize="10" textAnchor="middle">{String(point.x).slice(0, 18)}</text>
      </g>;
    })}
    {model.chartType === "line" && model.series.map((item) => { const seriesPoints = points.map((point, index) => ({ point, index })).filter(({ point }) => point.seriesId === item.id && point.value !== null); return <path key={item.id} d={seriesPoints.map(({ point, index }, lineIndex) => `${lineIndex ? "L" : "M"}${left + index * slot + slot / 2},${y(point.value!)}`).join(" ")} fill="none" stroke={COLORS[item.colorHint]} strokeWidth="2.5" />; })}
    <text x={width / 2} y={height - 5} fill="#7d939d" fontSize="11" textAnchor="middle">{model.xLabel}</text><text x="15" y={height / 2} fill="#7d939d" fontSize="11" textAnchor="middle" transform={`rotate(-90 15 ${height / 2})`}>{model.yLabel} ({model.unit})</text>
  </svg></div>;
}

function GraphCanvas(props: Props) {
  const model = props.visual.semanticModel;
  if (model.kind !== "process" && model.kind !== "claim_evidence_graph") return null;
  const elements = model.kind === "process" ? model.elements.map((item) => ({ id: item.id, label: item.label, kind: item.elementKind })) : model.nodes.map((item) => ({ id: item.id, label: item.label, kind: item.nodeKind === "claim" ? "process" as const : item.nodeKind === "source" ? "terminal" as const : "decision" as const }));
  const relationships = model.relationships.map((item) => ({ id: item.id, from: item.from, to: item.to, label: item.label, kind: item.kind === "supports" ? "strong" as const : item.kind === "contradicts" || item.kind === "objects_to" ? "dotted" as const : item.kind === "flow" || item.kind === "strong" || item.kind === "dotted" ? item.kind : "flow" as const }));
  const flowVisual: FlowVisualMessage = {
    schemaVersion: "1.0", visualMessageId: props.visual.visualMessageId, revision: props.visual.revision, diagramKind: "flowchart", title: props.visual.title, summary: props.visual.summary,
    semanticModel: { direction: model.direction, elements, relationships },
    storyboard: { schemaVersion: "1.0", startSceneId: props.scene.id, scenes: [{ id: props.scene.id, title: props.scene.title, caption: props.scene.caption, nodeIds: props.scene.entityIds, highlightNodeIds: props.scene.highlightEntityIds, transition: props.scene.transition, interactionCue: props.scene.interactionCue }] },
    renderer: { renderer: "react-flow", rendererSchemaVersion: "1.0", generatedFrom: "semantic_model", payload: JSON.stringify({ layout: "dagre", interaction: "read_only" }) },
    accessibleFallback: { heading: props.visual.title, summary: props.visual.summary, elements, relationships: relationships.map((item) => ({ id: item.id, text: `${item.from} ${item.label ?? "leads to"} ${item.to}` })), scenes: [{ id: props.scene.id, title: props.scene.title, caption: props.scene.caption }] },
    source: props.visual.source, sourceSessionId: props.visual.sourceSessionId, sourceRunId: props.visual.sourceRunId, createdAt: props.visual.createdAt,
  };
  const flowScene = flowVisual.storyboard.scenes[0] as VisualScene;
  return <VisualFlowCanvas visual={flowVisual} scene={flowScene} selectedIds={props.selectedIds} onSelectedIdsChange={props.onSelectedIdsChange} reducedMotion={props.reducedMotion} expanded={props.expanded} />;
}

export const ResearchVisualCanvas = forwardRef<HTMLDivElement, Props>(function ResearchVisualCanvas(props, ref) {
  const content = props.visual.diagramKind === "geographic_map" ? <GeographicCanvas {...props} />
    : props.visual.diagramKind === "timeline" ? <TimelineCanvas {...props} />
    : props.visual.diagramKind === "evidence_matrix" ? <MatrixCanvas {...props} />
    : props.visual.diagramKind === "chart" ? <ChartCanvas {...props} />
    : <GraphCanvas {...props} />;
  return <div ref={ref} className="h-full w-full" data-visual-form={props.visual.diagramKind}>{content}</div>;
});
