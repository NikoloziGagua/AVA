import { useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  AppWindow,
  AudioWaveform,
  BellRing,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Chrome,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  Eye,
  FileCode2,
  GitBranch,
  History,
  Instagram,
  KeyRound,
  LockKeyhole,
  Map as MapIcon,
  MessageCircle,
  Network,
  Play,
  RefreshCw,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UserRoundSearch,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  ExplorerRuntimeCapability,
  ExplorerTaskSummary,
} from "../api.js";
import type {
  ExplorerCapability,
  ExplorerDomain,
  ExplorerWorkflowNode,
  ReadinessDimension,
} from "./types.js";
import {
  eventCapabilityIdsForAtlas,
  formatObservedAt,
  readinessColor,
  readinessLabel,
  runtimeForCapability,
  type RuntimePresentation,
} from "./runtime.js";
import { WorkflowMap } from "./WorkflowMap.js";
import { explorerTaskStatusLabel } from "./task-utils.js";

export type ExplorerDepth = "overview" | "detailed" | "technical";

const DOMAIN_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  conversation: MessageCircle,
  voice: AudioWaveform,
  interpretation: BrainCircuit,
  orchestration: Network,
  browser: Chrome,
  desktop: AppWindow,
  "shell-files": TerminalSquare,
  coding: Code2,
  instagram: Instagram,
  whatsapp: MessageCircle,
  people: UserRoundSearch,
  memory: Database,
  playbooks: Route,
  automation: Clock3,
  notifications: BellRing,
  vision: Eye,
  services: Boxes,
  "self-improvement": Sparkles,
  "developer-collaboration": Bot,
  security: LockKeyhole,
  verification: ShieldCheck,
  interface: AppWindow,
};

export type DomainMapPosition = {
  domain: ExplorerDomain;
  x: number;
  y: number;
};

const MAP_WIDTH = 1180;
const MAP_HEIGHT = 700;
const MAP_CENTER_X = MAP_WIDTH / 2;
const MAP_CENTER_Y = MAP_HEIGHT / 2;
const DOMAIN_WIDTH = 152;
const DOMAIN_HEIGHT = 66;

export function layoutDomains(domains: readonly ExplorerDomain[]): DomainMapPosition[] {
  const ordered = [...domains].sort((a, b) => a.order - b.order);
  const innerCount = Math.min(8, ordered.length);
  return ordered.map((domain, index) => {
    const inner = index < innerCount;
    const ringIndex = inner ? index : index - innerCount;
    const ringCount = inner ? innerCount : Math.max(1, ordered.length - innerCount);
    const angle = -Math.PI / 2 + (ringIndex / ringCount) * Math.PI * 2 + (inner ? 0 : Math.PI / ringCount);
    const radiusX = inner ? 285 : 490;
    const radiusY = inner ? 185 : 292;
    return {
      domain,
      x: MAP_CENTER_X + Math.cos(angle) * radiusX - DOMAIN_WIDTH / 2,
      y: MAP_CENTER_Y + Math.sin(angle) * radiusY - DOMAIN_HEIGHT / 2,
    };
  });
}

function capabilityMatches(
  capability: ExplorerCapability,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    capability.name,
    capability.shortName,
    capability.description,
    capability.purpose,
    ...capability.examples,
    ...capability.runtime?.toolNames ?? [],
  ].some((value) => value.toLowerCase().includes(needle));
}

function domainState(
  capabilities: readonly ExplorerCapability[],
  runtime: readonly ExplorerRuntimeCapability[],
): {
  readiness: ExplorerRuntimeCapability["readiness"];
  ready: number;
  known: number;
} {
  const states = capabilities.map((capability) => runtimeForCapability(capability, runtime));
  const ready = states.filter((item) => item.readiness === "ready").length;
  const partial = states.filter((item) => item.readiness === "partially_ready").length;
  const known = states.filter((item) => item.readiness !== "unknown").length;
  if (!states.length || known === 0) return { readiness: "unknown", ready, known };
  if (ready === states.length) return { readiness: "ready", ready, known };
  if (ready + partial > 0) return { readiness: "partially_ready", ready, known };
  if (states.some((item) => item.readiness === "setup_required")) {
    return { readiness: "setup_required", ready, known };
  }
  return { readiness: "unavailable", ready, known };
}

function DomainSystemMap({
  domains,
  capabilities,
  runtime,
  query,
  onSelect,
}: {
  domains: readonly ExplorerDomain[];
  capabilities: readonly ExplorerCapability[];
  runtime: readonly ExplorerRuntimeCapability[];
  query: string;
  onSelect: (domain: ExplorerDomain) => void;
}) {
  const positions = useMemo(() => layoutDomains(domains), [domains]);
  const matchingDomains = useMemo(() => {
    if (!query.trim()) return new Set(domains.map((domain) => domain.id));
    return new Set(
      domains
        .filter((domain) => {
          const ownMatch = `${domain.name} ${domain.shortName} ${domain.description}`
            .toLowerCase()
            .includes(query.toLowerCase());
          const childMatch = capabilities.some(
            (capability) => capability.domainId === domain.id && capabilityMatches(capability, query),
          );
          return ownMatch || childMatch;
        })
        .map((domain) => domain.id),
    );
  }, [capabilities, domains, query]);

  return (
    <div className="no-scrollbar overflow-x-auto rounded-[24px] border border-white/[0.08] bg-black/35">
      <div
        className="relative"
        style={{
          width: MAP_WIDTH,
          height: MAP_HEIGHT,
          background:
            "radial-gradient(circle at 50% 50%, rgba(92,242,255,.12), transparent 18%)," +
            "radial-gradient(circle at 50% 50%, rgba(92,242,255,.035), transparent 57%)," +
            "radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px) 0 0 / 28px 28px",
        }}
        role="group"
        aria-label="AVA capability domain map"
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="atlasEdge" cx="50%" cy="50%" r="70%">
              <stop offset="0" stopColor="rgba(92,242,255,.52)" />
              <stop offset="1" stopColor="rgba(92,242,255,.07)" />
            </radialGradient>
          </defs>
          <circle cx={MAP_CENTER_X} cy={MAP_CENTER_Y} r="121" fill="none" stroke="rgba(92,242,255,.12)" />
          <circle
            cx={MAP_CENTER_X}
            cy={MAP_CENTER_Y}
            r="146"
            fill="none"
            stroke="rgba(159,198,212,.08)"
            strokeDasharray="4 10"
          />
          {positions.map(({ domain, x, y }) => (
            <line
              key={domain.id}
              x1={MAP_CENTER_X}
              y1={MAP_CENTER_Y}
              x2={x + DOMAIN_WIDTH / 2}
              y2={y + DOMAIN_HEIGHT / 2}
              stroke="url(#atlasEdge)"
              strokeWidth={matchingDomains.has(domain.id) ? 1.3 : 0.7}
              opacity={matchingDomains.has(domain.id) ? 0.82 : 0.14}
            />
          ))}
        </svg>

        <div
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center"
          style={{
            left: MAP_CENTER_X,
            top: MAP_CENTER_Y,
            width: 184,
            height: 184,
            border: "1px solid rgba(92,242,255,.34)",
            background:
              "radial-gradient(circle at 42% 30%,rgba(255,255,255,.17),rgba(92,242,255,.08) 34%,rgba(5,9,14,.96) 72%)",
            boxShadow:
              "0 0 0 18px rgba(92,242,255,.025),0 0 58px -12px rgba(92,242,255,.55),inset 0 1px rgba(255,255,255,.17)",
          }}
        >
          <div className="hud text-[9px] text-[var(--ac)]">Living system</div>
          <div className="mt-1 text-3xl font-semibold tracking-[0.16em] text-white/95">AVA</div>
          <div className="mt-2 text-[10px] text-white/42">
            {domains.length} domains · {capabilities.length} capabilities
          </div>
        </div>

        {positions.map(({ domain, x, y }) => {
          const children = capabilities.filter((capability) => capability.domainId === domain.id);
          const state = domainState(children, runtime);
          const Icon = DOMAIN_ICONS[domain.id] ?? GitBranch;
          const matches = matchingDomains.has(domain.id);
          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => onSelect(domain)}
              className="absolute flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-[opacity,transform,border-color,background] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
              style={{
                left: x,
                top: y,
                width: DOMAIN_WIDTH,
                height: DOMAIN_HEIGHT,
                opacity: matches ? 1 : 0.25,
                border: `1px solid ${matches ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.05)"}`,
                background: "linear-gradient(145deg,rgba(255,255,255,.07),rgba(7,10,16,.93))",
                boxShadow: matches ? "0 16px 36px -24px rgba(0,0,0,.9)" : "none",
              }}
              aria-label={`Open ${domain.name}, ${children.length} capabilities`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{
                  color: readinessColor(state.readiness),
                  border: `1px solid ${readinessColor(state.readiness)}`,
                  background: "rgba(0,0,0,.28)",
                }}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-white/82">
                  {domain.shortName}
                </span>
                <span className="mt-1 block text-[8px] text-white/35">
                  {children.length} nodes · {state.known} checked
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StateChip({
  presentation,
}: {
  presentation: RuntimePresentation;
}) {
  const color = readinessColor(presentation.readiness);
  return (
    <span
      className="hud inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[8px]"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: "rgba(0,0,0,.22)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {readinessLabel(presentation.readiness)}
    </span>
  );
}

function CapabilityCards({
  capabilities,
  runtime,
  query,
  onSelect,
}: {
  capabilities: readonly ExplorerCapability[];
  runtime: readonly ExplorerRuntimeCapability[];
  query: string;
  onSelect: (capability: ExplorerCapability) => void;
}) {
  const visible = capabilities.filter((capability) => capabilityMatches(capability, query));
  if (!visible.length) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-6 py-12 text-center text-xs text-white/40">
        No capability matched this search.
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((capability) => {
        const presentation = runtimeForCapability(capability, runtime);
        const Icon = DOMAIN_ICONS[capability.domainId] ?? Wrench;
        return (
          <button
            key={capability.id}
            type="button"
            onClick={() => onSelect(capability)}
            className="bg-card group min-h-[210px] overflow-hidden px-5 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
          >
            <span className="bg-card__ray" aria-hidden />
            <span className="bg-card__bracket bg-card__bracket--tl" aria-hidden />
            <span className="bg-card__bracket bg-card__bracket--br" aria-hidden />
            <span className="relative z-[2] flex h-full flex-col">
              <span className="flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(92,242,255,.14)] bg-[rgba(92,242,255,.055)] text-[var(--ac)]">
                  <Icon size={18} />
                </span>
                <StateChip presentation={presentation} />
              </span>
              <span className="hud mt-5 text-[8px] text-white/30">{capability.stability}</span>
              <span className="mt-1 block text-[15px] font-semibold text-white/88">{capability.name}</span>
              <span className="mt-2 line-clamp-3 text-[10.5px] leading-relaxed text-white/46">
                {capability.description}
              </span>
              <span className="mt-auto flex items-center justify-between pt-5">
                <span className="text-[9px] text-white/30">
                  {capability.workflow ? `${capability.workflow.nodes.length} workflow nodes` : "Workflow not mapped"}
                </span>
                <span className="hud text-[8px] text-[var(--ac)] transition-transform group-hover:translate-x-1">
                  Inspect →
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type DimensionState = {
  state: "met" | "partial" | "unmet" | "unknown";
  reason: string;
};

function dimensionState(
  dimension: ReadinessDimension,
  capability: ExplorerCapability,
  runtime: RuntimePresentation,
  tasks: readonly ExplorerTaskSummary[],
): DimensionState {
  if (dimension === "defined") {
    return {
      state: capability.definition.implementation === "implemented" ? "met" : "partial",
      reason: `${capability.definition.implementation}; ${capability.definition.sourceReferences.length} source reference(s).`,
    };
  }
  if (dimension === "configured") {
    if (runtime.readiness === "setup_required") return { state: "unmet", reason: runtime.reason };
    if (runtime.readiness === "ready" || runtime.readiness === "partially_ready") {
      return { state: "met", reason: runtime.reason };
    }
    return { state: "unknown", reason: runtime.reason };
  }
  if (dimension === "authenticated") {
    const accountProof = runtime.evidence.some((item) => /authenticat|linked session/i.test(item.summary));
    return accountProof
      ? { state: "partial", reason: "Dependency evidence mentions an account state; no direct authenticated workflow test is recorded." }
      : { state: "unknown", reason: "Authentication has not been directly verified by the Explorer probe." };
  }
  if (dimension === "available") {
    if (runtime.readiness === "ready") return { state: "met", reason: runtime.reason };
    if (runtime.readiness === "unavailable") return { state: "unmet", reason: runtime.reason };
    if (runtime.readiness === "partially_ready") return { state: "partial", reason: runtime.reason };
    return { state: "unknown", reason: runtime.reason };
  }
  if (dimension === "healthy") {
    if (runtime.health === "healthy") return { state: "met", reason: runtime.reason };
    if (runtime.health === "degraded") return { state: "partial", reason: runtime.reason };
    if (runtime.health === "unavailable") return { state: "unmet", reason: runtime.reason };
    return { state: "unknown", reason: "No direct health execution has been recorded." };
  }
  if (dimension === "tested") {
    const testRefs = capability.definition.sourceReferences.filter((reference) => reference.kind === "test");
    return testRefs.length
      ? {
          state: "partial",
          reason: `${testRefs.length} automated test reference(s) exist; Explorer does not yet have the latest test-run result.`,
        }
      : { state: "unknown", reason: "No automated-test evidence is linked to this capability." };
  }

  const ids = new Set([
    ...eventCapabilityIdsForAtlas(capability),
    ...runtime.sources,
  ]);
  const recent = tasks.find(
    (task) =>
      (task.status === "finished" || task.status === "completed") &&
      task.errorCount === 0 &&
      task.capabilityIds.some((capabilityId) => ids.has(capabilityId)),
  );
  return recent
    ? {
        state: "partial",
        reason: `Observed in task ${recent.id}, but that run did not record independent verification.`,
      }
    : { state: "unknown", reason: "No recent error-free run with a final response is linked yet." };
}

const DIMENSION_TONE: Record<DimensionState["state"], { color: string; Icon: ComponentType<{ size?: number }> }> = {
  met: { color: "var(--ac-live)", Icon: CheckCircle2 },
  partial: { color: "var(--ac-exec)", Icon: RefreshCw },
  unmet: { color: "var(--ac-stop)", Icon: XCircle },
  unknown: { color: "rgba(255,255,255,.38)", Icon: CircleHelp },
};

function ReadinessMatrix({
  capability,
  runtime,
  tasks,
}: {
  capability: ExplorerCapability;
  runtime: RuntimePresentation;
  tasks: readonly ExplorerTaskSummary[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {capability.readiness.map((requirement) => {
        const result = dimensionState(requirement.dimension, capability, runtime, tasks);
        const tone = DIMENSION_TONE[result.state];
        return (
          <div
            key={requirement.dimension}
            className="rounded-xl border border-white/[0.07] bg-black/25 px-3.5 py-3"
            title={result.reason}
          >
            <div className="flex items-center gap-2">
              <tone.Icon size={13} />
              <span className="hud text-[8px]" style={{ color: tone.color }}>
                {requirement.dimension.replace("-", " ")}
              </span>
            </div>
            <div className="mt-2 text-[9px] leading-relaxed text-white/38">
              {result.reason}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailList({
  title,
  items,
  empty = "None recorded.",
}: {
  title: string;
  items: readonly string[];
  empty?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/22 px-5 py-4">
      <div className="hud text-[9px] text-white/38">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item) => (
          <div key={item} className="flex gap-2 text-[10.5px] leading-relaxed text-white/52">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--ac)]" />
            <span>{item}</span>
          </div>
        )) : <div className="text-[10px] text-white/30">{empty}</div>}
      </div>
    </div>
  );
}

function AtlasBreadcrumbs({
  domain,
  capability,
  onBack,
  onBackToMap,
}: {
  domain: ExplorerDomain | null;
  capability?: ExplorerCapability | null;
  onBack: () => void;
  onBackToMap: () => void;
}) {
  const backLabel = capability && domain
    ? `Back to ${domain.name}`
    : "Back to full system map";

  return (
    <nav
      aria-label="Atlas breadcrumb"
      className="sticky top-2 z-30 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl border border-[rgba(92,242,255,.18)] bg-[#080c12]/95 px-3 py-2 shadow-[0_16px_45px_rgba(0,0,0,.42)] backdrop-blur-xl sm:px-4"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-8 items-center gap-2 rounded-xl border border-[rgba(92,242,255,.2)] bg-[rgba(92,242,255,.08)] px-3 text-[10px] font-semibold text-[var(--ac-text)] transition-colors hover:border-[rgba(92,242,255,.42)] hover:bg-[rgba(92,242,255,.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
      >
        <ChevronLeft size={14} aria-hidden />
        {backLabel}
      </button>

      <div className="hidden h-5 w-px bg-white/[0.09] sm:block" aria-hidden />
      <ol className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto text-[9px] text-white/38">
        <li className="shrink-0">
          <button
            type="button"
            onClick={onBackToMap}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.045] hover:text-[var(--ac)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
          >
            <MapIcon size={12} aria-hidden />
            System map
          </button>
        </li>
        {domain && (
          <>
            <li aria-hidden className="shrink-0 text-white/20">
              <ChevronRight size={12} />
            </li>
            <li className="shrink-0">
              {capability ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-lg px-2 py-1.5 hover:bg-white/[0.045] hover:text-[var(--ac)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
                >
                  {domain.name}
                </button>
              ) : (
                <span aria-current="page" className="px-2 py-1.5 font-medium text-white/68">
                  {domain.name}
                </span>
              )}
            </li>
          </>
        )}
        {capability && (
          <>
            <li aria-hidden className="shrink-0 text-white/20">
              <ChevronRight size={12} />
            </li>
            <li
              aria-current="page"
              className="truncate px-2 py-1.5 font-medium text-white/68"
              title={capability.name}
            >
              {capability.name}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

function CapabilityDetail({
  capability,
  domain,
  runtimeCapabilities,
  tasks,
  depth,
  onBack,
  onBackToMap,
  onOpenTask,
  onLaunch,
}: {
  capability: ExplorerCapability;
  domain: ExplorerDomain | null;
  runtimeCapabilities: readonly ExplorerRuntimeCapability[];
  tasks: readonly ExplorerTaskSummary[];
  depth: ExplorerDepth;
  onBack: () => void;
  onBackToMap: () => void;
  onOpenTask: (taskId: string) => void;
  onLaunch: (prompt: string) => void;
}) {
  const [selectedNode, setSelectedNode] = useState<ExplorerWorkflowNode | null>(
    capability.workflow?.nodes.find((node) => node.id === capability.workflow?.entryNodeId) ?? null,
  );
  const runtime = runtimeForCapability(capability, runtimeCapabilities);
  const color = readinessColor(runtime.readiness);
  const relatedTasks = tasks.filter((task) => {
    const ids = new Set([
      ...eventCapabilityIdsForAtlas(capability),
      ...runtime.sources,
    ]);
    return task.capabilityIds.some((id) => ids.has(id));
  });

  return (
    <div className="space-y-5">
      <AtlasBreadcrumbs
        domain={domain}
        capability={capability}
        onBack={onBack}
        onBackToMap={onBackToMap}
      />

      <div className="lg-slab overflow-hidden px-6 py-6 sm:px-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="max-w-3xl">
            <div className="hud text-[9px] text-[var(--ac)]">{capability.domainId} / capability</div>
            <h2 className="mt-2 text-2xl font-semibold text-white/94">{capability.name}</h2>
            <p className="mt-3 text-[12px] leading-relaxed text-white/52">{capability.description}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">{capability.purpose}</p>
          </div>
          <div className="min-w-[220px] rounded-2xl border border-white/[0.08] bg-black/28 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
              <span className="hud text-[10px]" style={{ color }}>{readinessLabel(runtime.readiness)}</span>
            </div>
            <div className="mt-3 text-[10px] leading-relaxed text-white/48">{runtime.reason}</div>
            <div className="hud mt-3 text-[8px] text-white/28">
              Checked {formatObservedAt(runtime.checkedAt)} · {runtime.confidence} confidence
            </div>
          </div>
        </div>
      </div>

      <section className="lg-slab px-5 py-5 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="hud text-[10px] text-[var(--ac)]">Readiness evidence</div>
            <div className="mt-1 text-[10px] text-white/34">Separate checks—never one invented percentage.</div>
          </div>
          <span className="hud text-[8px] text-white/28">{capability.definition.implementation}</span>
        </div>
        <ReadinessMatrix capability={capability} runtime={runtime} tasks={tasks} />
      </section>

      {capability.workflow && (
        <section className="lg-slab px-5 py-5 sm:px-6">
          <div className="mb-4">
            <div className="hud text-[10px] text-[var(--ac)]">Operational workflow</div>
            <h3 className="mt-1 text-base font-semibold text-white/85">{capability.workflow.name}</h3>
            <p className="mt-1 text-[10px] text-white/38">{capability.workflow.description}</p>
          </div>
          <div className={selectedNode ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]" : ""}>
            <WorkflowMap
              workflow={capability.workflow}
              selectedNodeId={selectedNode?.id}
              onSelectNode={setSelectedNode}
            />
            {selectedNode && (
              <aside className="rounded-2xl border border-[rgba(92,242,255,.15)] bg-black/30 px-5 py-5">
                <div className="hud text-[8px] text-[var(--ac)]">{selectedNode.kind}</div>
                <div className="mt-2 text-base font-semibold text-white/88">{selectedNode.name}</div>
                <p className="mt-3 text-[10.5px] leading-relaxed text-white/48">{selectedNode.description}</p>
                <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-4">
                  <div>
                    <div className="hud text-[8px] text-white/28">Capability</div>
                    <div className="mt-1 text-[10px] text-white/58">{selectedNode.capabilityId}</div>
                  </div>
                  <div>
                    <div className="hud text-[8px] text-white/28">Tool</div>
                    <div className="mt-1 text-[10px] text-white/58">{selectedNode.toolName ?? "No direct tool"}</div>
                  </div>
                  <div>
                    <div className="hud text-[8px] text-white/28">Evidence produced</div>
                    <div className="mt-1 text-[10px] text-white/58">
                      {selectedNode.producesEvidence?.join(", ") || "None declared"}
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
        </section>
      )}

      {depth !== "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DetailList
            title="Inputs"
            items={capability.inputs.map(
              (input) => `${input.name}${input.required ? " · required" : ""}${input.sensitive ? " · sensitive" : ""} — ${input.description}`,
            )}
          />
          <DetailList
            title="Outputs and side effects"
            items={[
              ...capability.outputs.map(
                (output) => `${output.name}${output.persistent ? " · persistent" : ""} — ${output.description}`,
              ),
              ...capability.safety.sideEffects,
            ]}
          />
          <DetailList
            title="Dependencies"
            items={capability.dependencies.map(
              (dependency) =>
                `${dependency.relationship} ${dependency.targetId}${dependency.required ? " · required" : " · optional"} — ${dependency.description}`,
            )}
          />
          <DetailList
            title="Verification"
            items={[
              ...capability.verification.successCriteria,
              ...capability.verification.limitations.map((item) => `Limitation: ${item}`),
            ]}
          />
          <DetailList
            title="Safety and stop conditions"
            items={[
              `Risk: ${capability.safety.risk}; approval: ${capability.safety.approval}.`,
              ...capability.safety.stopConditions,
              ...capability.safety.redactions.map((item) => `Redaction: ${item}`),
            ]}
          />
          <DetailList
            title="Runtime evidence"
            items={runtime.evidence.map(
              (item) => `${item.kind} · ${item.source} — ${item.summary}`,
            )}
            empty="No runtime evidence adapter has reported this capability."
          />
        </div>
      )}

      {depth === "technical" && (
        <section className="lg-slab px-5 py-5 sm:px-6">
          <div className="hud text-[10px] text-[var(--ac)]">Source references</div>
          <div className="mt-4 space-y-2">
            {capability.definition.sourceReferences.map((reference) => (
              <div
                key={`${reference.path}:${reference.symbol ?? ""}`}
                className="grid gap-2 rounded-xl border border-white/[0.06] bg-black/22 px-4 py-3 text-[10px] sm:grid-cols-[90px_1fr]"
              >
                <span className="hud text-[8px] text-white/30">{reference.kind}</span>
                <span className="font-mono text-white/55">
                  {reference.path}{reference.symbol ? ` · ${reference.symbol}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="lg-slab px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="hud text-[10px] text-[var(--ac)]">Observed tasks</div>
            <div className="mt-1 text-[10px] text-white/34">
              {relatedTasks.length
                ? `${relatedTasks.length} newly instrumented run(s) are linked.`
                : "No instrumented run has used this capability yet."}
            </div>
          </div>
          {capability.examples[0] && (
            <button
              type="button"
              onClick={() => onLaunch(capability.examples[0]!)}
              className="btn-deck btn-primary flex items-center gap-2"
            >
              Try an example <Play size={13} />
            </button>
          )}
        </div>
        {relatedTasks.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {relatedTasks.slice(0, 6).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                aria-label={`Open task ${task.sessionTitle ?? task.id}`}
                className="rounded-xl border border-white/[0.07] bg-black/24 px-4 py-3 text-left transition-colors hover:border-[rgba(92,242,255,.24)] hover:bg-[rgba(92,242,255,.035)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[11px] font-semibold text-white/66">
                    {task.sessionTitle ?? task.id}
                  </span>
                  <span className="hud text-[8px] text-white/32">
                    {explorerTaskStatusLabel(task.status)}
                  </span>
                </div>
                <div className="mt-2 text-[9px] text-white/30">
                  {task.toolCallCount} tools · {task.errorCount} errors · verification {task.verification.status.replace("_", " ")}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function CapabilityAtlas({
  domains,
  capabilities,
  runtime,
  tasks,
  query,
  depth,
  selectedDomainId,
  selectedCapabilityId,
  onSelectDomain,
  onSelectCapability,
  onBackToMap,
  onBackToDomain,
  onOpenTask,
  onLaunch,
}: {
  domains: readonly ExplorerDomain[];
  capabilities: readonly ExplorerCapability[];
  runtime: readonly ExplorerRuntimeCapability[];
  tasks: readonly ExplorerTaskSummary[];
  query: string;
  depth: ExplorerDepth;
  selectedDomainId: string | null;
  selectedCapabilityId: string | null;
  onSelectDomain: (id: string) => void;
  onSelectCapability: (id: string) => void;
  onBackToMap: () => void;
  onBackToDomain: () => void;
  onOpenTask: (taskId: string) => void;
  onLaunch: (prompt: string) => void;
}) {
  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId) ?? null;
  const selectedCapability =
    capabilities.find((capability) => capability.id === selectedCapabilityId) ?? null;

  if (selectedCapability) {
    const capabilityDomain =
      domains.find((domain) => domain.id === selectedCapability.domainId) ?? null;
    return (
      <CapabilityDetail
        capability={selectedCapability}
        domain={capabilityDomain}
        runtimeCapabilities={runtime}
        tasks={tasks}
        depth={depth}
        onBack={onBackToDomain}
        onBackToMap={onBackToMap}
        onOpenTask={onOpenTask}
        onLaunch={onLaunch}
      />
    );
  }

  if (selectedDomain) {
    const children = capabilities.filter((capability) => capability.domainId === selectedDomain.id);
    const state = domainState(children, runtime);
    const Icon = DOMAIN_ICONS[selectedDomain.id] ?? GitBranch;
    return (
      <div className="space-y-5">
        <AtlasBreadcrumbs
          domain={selectedDomain}
          onBack={onBackToMap}
          onBackToMap={onBackToMap}
        />
        <div className="lg-slab px-6 py-6 sm:px-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(92,242,255,.18)] bg-[rgba(92,242,255,.06)] text-[var(--ac)]">
                <Icon size={22} />
              </div>
              <div>
                <div className="hud text-[9px] text-[var(--ac)]">Capability domain</div>
                <h2 className="mt-1 text-2xl font-semibold text-white/92">{selectedDomain.name}</h2>
                <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/45">
                  {selectedDomain.description}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="hud text-[9px]" style={{ color: readinessColor(state.readiness) }}>
                {readinessLabel(state.readiness)}
              </div>
              <div className="mt-1 text-[9px] text-white/30">
                {children.length} capabilities · {state.known} evidence-linked
              </div>
            </div>
          </div>
        </div>
        <CapabilityCards
          capabilities={children}
          runtime={runtime}
          query={query}
          onSelect={(capability) => onSelectCapability(capability.id)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="hud text-[10px] text-[var(--ac)]">Capability atlas</div>
          <h2 className="mt-2 text-xl font-semibold text-white/90">See how AVA is built—and what works now.</h2>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-white/42">
            Enter through a domain, open a capability, inspect its operational workflow, then connect it to real task evidence.
          </p>
        </div>
        <div className="hud text-[8px] text-white/28">
          Definition ≠ availability ≠ verified success
        </div>
      </div>
      <DomainSystemMap
        domains={domains}
        capabilities={capabilities}
        runtime={runtime}
        query={query}
        onSelect={(domain) => onSelectDomain(domain.id)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {domains.map((domain) => {
          const children = capabilities.filter((capability) => capability.domainId === domain.id);
          const state = domainState(children, runtime);
          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => onSelectDomain(domain.id)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-left transition-colors hover:border-[rgba(92,242,255,.25)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-white/66">{domain.shortName}</span>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: readinessColor(state.readiness) }} />
              </div>
              <div className="mt-2 text-[9px] text-white/30">{children.length} capabilities</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
