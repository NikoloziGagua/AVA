import type {
  ExplorerCapabilityHealth,
  ExplorerCapabilityReadiness,
  ExplorerRuntimeCapability,
} from "../api.js";
import type { ExplorerCapability } from "./types.js";

export type RuntimePresentation = {
  readiness: ExplorerCapabilityReadiness;
  health: ExplorerCapabilityHealth;
  reason: string;
  confidence: "high" | "medium" | "low";
  checkedAt: number | null;
  evidence: ExplorerRuntimeCapability["evidence"];
  sources: readonly string[];
};

type RuntimeAdapterBinding = {
  ids: readonly string[];
  /** Direct means the runtime probe describes this capability itself. */
  direct: boolean;
};

/**
 * The server currently exposes a compact operational registry while the Atlas
 * is deliberately more granular. Keep the bridge explicit: domain fallback
 * can combine unrelated services and turn one missing integration into a
 * false warning on another capability.
 */
const CAPABILITY_RUNTIME_BINDINGS: Readonly<Record<string, RuntimeAdapterBinding>> = {
  "conversation.text-turn": { ids: ["conversation"], direct: true },
  "voice.realtime": { ids: ["voice"], direct: true },
  "interpretation.request-mode": { ids: ["conversation"], direct: false },
  "orchestration.agent-loop": { ids: ["conversation"], direct: false },
  "browser.persistent-control": { ids: ["browser"], direct: true },
  "desktop.microsoft-ufo": { ids: ["ufo"], direct: true },
  "shell-files.shell": { ids: ["files"], direct: true },
  "shell-files.filesystem": { ids: ["files"], direct: true },
  "coding.project-work": { ids: ["code"], direct: true },
  "instagram.messaging": { ids: ["instagram"], direct: true },
  "instagram.connection": { ids: ["instagram"], direct: false },
  "instagram.send-dm": { ids: ["instagram"], direct: false },
  "whatsapp.messaging": { ids: ["whatsapp"], direct: true },
  "whatsapp.connection": { ids: ["whatsapp"], direct: false },
  "whatsapp.send-message": { ids: ["whatsapp"], direct: false },
  "people.identity-resolution": { ids: ["memory"], direct: false },
  "memory.durable": { ids: ["memory"], direct: true },
  "playbooks.procedural-memory": { ids: ["memory"], direct: false },
  "automation.watches": { ids: ["watches"], direct: true },
  "notifications.push-approvals": { ids: ["push"], direct: true },
  "vision.screen-inspection": { ids: ["screen"], direct: true },
  "services.google-places": { ids: ["places"], direct: true },
  "services.shopify-products": { ids: ["shopify"], direct: true },
  "self-improvement.pipeline": { ids: ["self"], direct: true },
  "developer-collaboration.claude": { ids: ["code"], direct: false },
};

const LEGACY_EVENT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "desktop.native-control": ["computer"],
};

export function eventCapabilityIdsForAtlas(
  capability: ExplorerCapability,
): readonly string[] {
  return [
    ...new Set([
      capability.id,
      capability.domainId,
      ...(CAPABILITY_RUNTIME_BINDINGS[capability.id]?.ids ?? []),
      ...(LEGACY_EVENT_ALIASES[capability.id] ?? []),
    ]),
  ];
}

const READINESS_ORDER: Record<ExplorerCapabilityReadiness, number> = {
  unavailable: 0,
  setup_required: 1,
  unknown: 2,
  partially_ready: 3,
  ready: 4,
};

const HEALTH_ORDER: Record<ExplorerCapabilityHealth, number> = {
  unavailable: 0,
  degraded: 1,
  unknown: 2,
  healthy: 3,
};

/**
 * Relates the detailed, source-declared Atlas to today's coarser runtime probes.
 * A domain-level probe is never promoted into proof of a sub-capability: it is
 * displayed as inherited dependency evidence and its reason remains visible.
 */
export function runtimeForCapability(
  capability: ExplorerCapability,
  runtime: readonly ExplorerRuntimeCapability[],
): RuntimePresentation {
  const byId = new Map(runtime.map((item) => [item.id, item]));
  const exact = byId.get(capability.id);
  const binding = CAPABILITY_RUNTIME_BINDINGS[capability.id];
  const ids = exact ? [capability.id] : (binding?.ids ?? []);
  const matches = ids
    .map((id) => byId.get(id))
    .filter((item): item is ExplorerRuntimeCapability => !!item);

  if (!matches.length) {
    return {
      readiness: "unknown",
      health: "unknown",
      reason: "Defined in AVA's registry, but no runtime evidence adapter reports this capability yet.",
      confidence: "low",
      checkedAt: null,
      evidence: [],
      sources: [],
    };
  }

  if (matches.length === 1) {
    const match = matches[0]!;
    const inherited = !exact && binding?.direct !== true;
    return {
      readiness:
        inherited && match.readiness === "ready"
          ? "partially_ready"
          : match.readiness,
      health: inherited && match.health === "healthy" ? "unknown" : match.health,
      reason: inherited
        ? `${match.reason} This is dependency-level evidence, not a direct execution test of ${capability.shortName}.`
        : match.reason,
      confidence: inherited && match.statusConfidence === "high" ? "medium" : match.statusConfidence,
      checkedAt: match.lastChecked,
      evidence: match.evidence,
      sources: [match.id],
    };
  }

  const readiness = matches
    .map((item) => item.readiness)
    .sort((a, b) => READINESS_ORDER[a] - READINESS_ORDER[b])[0]!;
  const health = matches
    .map((item) => item.health)
    .sort((a, b) => HEALTH_ORDER[a] - HEALTH_ORDER[b])[0]!;
  return {
    readiness,
    health,
    reason: matches.map((item) => `${item.name}: ${item.reason}`).join(" "),
    confidence: matches.some((item) => item.statusConfidence === "low") ? "low" : "medium",
    checkedAt: Math.max(...matches.map((item) => item.lastChecked)),
    evidence: matches.flatMap((item) => item.evidence),
    sources: matches.map((item) => item.id),
  };
}

export function readinessLabel(readiness: ExplorerCapabilityReadiness): string {
  switch (readiness) {
    case "ready": return "Ready";
    case "partially_ready": return "Partially ready";
    case "setup_required": return "Setup required";
    case "unavailable": return "Unavailable";
    case "unknown": return "Unknown";
  }
}

export function readinessColor(readiness: ExplorerCapabilityReadiness): string {
  switch (readiness) {
    case "ready": return "var(--ac-live)";
    case "partially_ready": return "var(--ac-exec)";
    case "setup_required": return "var(--ac-exec)";
    case "unavailable": return "var(--ac-stop)";
    case "unknown": return "rgba(255,255,255,.42)";
  }
}

export function healthLabel(health: ExplorerCapabilityHealth): string {
  switch (health) {
    case "healthy": return "Healthy";
    case "degraded": return "Degraded";
    case "unavailable": return "Unavailable";
    case "unknown": return "Not tested live";
  }
}

export function formatObservedAt(timestamp: number | null): string {
  if (!timestamp) return "Never checked";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
