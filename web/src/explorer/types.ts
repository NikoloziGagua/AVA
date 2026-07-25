/**
 * Static Explorer definitions describe what exists in AVA's source tree.
 * They deliberately do not claim that a capability is configured, healthy,
 * authenticated, or working on the current machine. Those claims belong in
 * `CapabilityRuntimeEvidence`.
 */

export type ExplorerDomainId = string;
export type ExplorerCapabilityId = string;
export type ExplorerWorkflowId = string;
export type ExplorerWorkflowNodeId = string;

export type CapabilityStability = "core" | "beta" | "experimental";
export type CapabilityImplementation = "implemented" | "partial" | "experimental";

export type ReadinessDimension =
  | "defined"
  | "configured"
  | "authenticated"
  | "available"
  | "healthy"
  | "tested"
  | "recently-successful";

export type EvidenceKind =
  | "source"
  | "unit-test"
  | "health-check"
  | "tool-result"
  | "api-response"
  | "exit-code"
  | "dom-confirmation"
  | "visual-confirmation"
  | "artifact"
  | "task-event";

export type SourceReference = {
  path: string;
  symbol?: string;
  kind: "implementation" | "test" | "documentation" | "route";
  note?: string;
};

export type ExplorerDomain = {
  id: ExplorerDomainId;
  name: string;
  shortName: string;
  description: string;
  order: number;
};

export type CapabilityInput = {
  name: string;
  description: string;
  required: boolean;
  sensitive?: boolean;
  examples?: readonly string[];
};

export type CapabilityOutput = {
  name: string;
  description: string;
  persistent?: boolean;
};

export type DependencyTargetType =
  | "capability"
  | "tool"
  | "service"
  | "application"
  | "model"
  | "data-store"
  | "process"
  | "permission";

export type DependencyRelationship =
  | "uses"
  | "depends-on"
  | "reads-from"
  | "writes-to"
  | "verifies-with"
  | "requires"
  | "falls-back-to";

export type ExplorerDependency = {
  targetType: DependencyTargetType;
  targetId: string;
  relationship: DependencyRelationship;
  required: boolean;
  description: string;
};

export type CapabilityVerification = {
  mandatory: boolean;
  successCriteria: readonly string[];
  evidenceKinds: readonly EvidenceKind[];
  limitations: readonly string[];
};

export type CapabilitySafety = {
  risk: "read-only" | "low" | "medium" | "high" | "mixed";
  approval: "never" | "policy-dependent" | "always";
  sideEffects: readonly string[];
  sensitiveData: readonly string[];
  redactions: readonly string[];
  stopConditions: readonly string[];
};

export type ReadinessRequirement = {
  dimension: ReadinessDimension;
  required: boolean;
  description: string;
  acceptableEvidence: readonly EvidenceKind[];
};

/**
 * A binding tells the runtime adapter where evidence may be found. A snapshot
 * path is a locator, not a status claim; Explorer still needs an observation
 * timestamp and evidence before it can render a readiness state.
 */
export type RuntimeSnapshotBinding = {
  path: string;
  dimension: ReadinessDimension;
  interpretation: "boolean" | "non-zero" | "non-null" | "attached";
  note?: string;
};

export type CapabilityRuntimeBinding = {
  snapshot?: readonly RuntimeSnapshotBinding[];
  toolNames?: readonly string[];
  apiRoutes?: readonly string[];
  eventCapabilityIds?: readonly string[];
};

export type WorkflowNodeKind =
  | "request"
  | "decision"
  | "operation"
  | "external-action"
  | "verification"
  | "result"
  | "stop";

export type ExplorerWorkflowNode = {
  id: ExplorerWorkflowNodeId;
  capabilityId: ExplorerCapabilityId;
  /**
   * Optional logical containment within this workflow. This is independent of
   * execution edges: a "Messages" branch can own resolve/open/read/send steps
   * while those steps still form a directed operational graph.
   */
  parentNodeId?: ExplorerWorkflowNodeId;
  name: string;
  description: string;
  kind: WorkflowNodeKind;
  toolName?: string;
  producesEvidence?: readonly EvidenceKind[];
};

export type WorkflowEdgeKind =
  | "next"
  | "branch"
  | "fallback"
  | "retry"
  | "verification"
  | "stop";

export type ExplorerWorkflowEdge = {
  id: string;
  from: ExplorerWorkflowNodeId;
  to: ExplorerWorkflowNodeId;
  kind: WorkflowEdgeKind;
  label?: string;
};

export type ExplorerWorkflow = {
  id: ExplorerWorkflowId;
  name: string;
  description: string;
  entryNodeId: ExplorerWorkflowNodeId;
  nodes: readonly ExplorerWorkflowNode[];
  edges: readonly ExplorerWorkflowEdge[];
};

export type ExplorerCapability = {
  id: ExplorerCapabilityId;
  domainId: ExplorerDomainId;
  parentId?: ExplorerCapabilityId;
  name: string;
  shortName: string;
  description: string;
  purpose: string;
  stability: CapabilityStability;
  definition: {
    implementation: CapabilityImplementation;
    sourceReferences: readonly SourceReference[];
  };
  examples: readonly string[];
  inputs: readonly CapabilityInput[];
  outputs: readonly CapabilityOutput[];
  dependencies: readonly ExplorerDependency[];
  readiness: readonly ReadinessRequirement[];
  verification: CapabilityVerification;
  safety: CapabilitySafety;
  runtime?: CapabilityRuntimeBinding;
  workflow?: ExplorerWorkflow;
};

export type RuntimeEvidenceState = "met" | "unmet" | "degraded" | "unknown";

export type ReadinessObservation = {
  dimension: ReadinessDimension;
  state: RuntimeEvidenceState;
  observedAt: number;
  reason: string;
  evidenceIds: readonly string[];
};

/**
 * Runtime evidence is intentionally a separate record from the static registry.
 * The backend can append/replace these observations without rewriting capability
 * definitions or presenting documentation as proof of successful execution.
 */
export type CapabilityRuntimeEvidence = {
  capabilityId: ExplorerCapabilityId;
  observedAt: number;
  observations: readonly ReadinessObservation[];
  lastSuccessfulTaskId?: string;
  lastFailedTaskId?: string;
};

export type ExplorerRegistry = {
  domains: readonly ExplorerDomain[];
  capabilities: readonly ExplorerCapability[];
};
