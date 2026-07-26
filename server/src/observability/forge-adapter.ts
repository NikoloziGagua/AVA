import type {
  AgentRoleFamily,
  ObservabilityParentContext,
  RecordEventInput,
} from "./types.js";

/**
 * Forge remains a separate control plane. AVA integrates it as a nested runtime
 * through this explicit contract; it does not reach into Forge's database or
 * create a hidden command route around Forge's own policy/journal.
 *
 * These names match the current Forge journal roster. Unknown future stations
 * remain valid because the wire contract accepts any string and carries the
 * canonical family separately.
 */
export const FORGE_AGENT_ROLES = [
  "specification",
  "repository-analyst",
  "architect",
  "backend-engineer",
  "frontend-engineer",
  "test-engineer",
  "code-reviewer",
  "safety-reviewer",
  "ui-verifier",
  "documentation-writer",
  "integrator",
] as const;

export type ForgeAgentRole = typeof FORGE_AGENT_ROLES[number] | (string & {});

export const FORGE_ROLE_FAMILY: Record<string, AgentRoleFamily> = {
  specification: "specification",
  "repository-analyst": "analysis",
  architect: "architecture",
  "backend-engineer": "implementation",
  "frontend-engineer": "implementation",
  "test-engineer": "testing",
  "code-reviewer": "review",
  "safety-reviewer": "safety",
  "ui-verifier": "verification",
  "documentation-writer": "documentation",
  integrator: "integration",
};

export type ForgeActor =
  | { kind: "control-plane" }
  | { kind: "agent"; agent: ForgeAgentRole; run_id: string }
  | { kind: "human" };

/** Minimal projection of Forge's append-only journal event. */
export type ForgeJournalEvent = {
  seq: number;
  change_seq: number;
  id: string;
  type: string;
  change_id: string;
  stage_run_id: string | null;
  actor: ForgeActor;
  at: number;
  payload: unknown;
};

export type ForgeRuntimeRegistration = {
  adapterVersion: 1;
  runtimeId: string;
  forgeInstanceId: string;
  avaContext: ObservabilityParentContext;
  changeId: string;
  roles: readonly string[];
  /**
   * The sequence AVA has durably accepted. Forge may replay anything after this
   * value; `(producer_id, producer_event_id)` makes replay idempotent.
   */
  acknowledgedSequence: number;
};

export type ForgeEventEnvelope = {
  runId: string;
  input: RecordEventInput;
};

function actorFields(actor: ForgeActor): Pick<
  RecordEventInput,
  "actorType" | "actorId" | "actorRole"
> {
  if (actor.kind === "agent") {
    return {
      actorType: "agent",
      actorId: actor.run_id,
      actorRole: actor.agent,
    };
  }
  if (actor.kind === "human") {
    return { actorType: "human", actorId: null, actorRole: null };
  }
  return { actorType: "forge", actorId: "control-plane", actorRole: "orchestrator" };
}

function eventStatus(type: string): string {
  if (
    type.endsWith(".failed") ||
    type.endsWith(".errored") ||
    type === "agent.errored"
  ) return "error";
  if (type.endsWith(".blocked") || type.endsWith(".requested")) return "waiting";
  if (
    type.endsWith(".completed") ||
    type.endsWith(".passed") ||
    type.endsWith(".approved") ||
    type.endsWith(".shipped")
  ) return "success";
  return "running";
}

/**
 * Map, do not reinterpret. Forge's journal remains authoritative for its
 * internal state machine; AVA adds cross-runtime causality and visibility.
 * Cost/tool execution should be attached only by the Forge event that actually
 * observed the provider request or command. Router/parent events never copy it.
 */
export function mapForgeJournalEvent(input: {
  registration: ForgeRuntimeRegistration;
  forgeRunId: string;
  event: ForgeJournalEvent;
}): ForgeEventEnvelope {
  const { registration, event } = input;
  const actor = actorFields(event.actor);
  const roleFamily = actor.actorRole
    ? FORGE_ROLE_FAMILY[actor.actorRole] ?? "general"
    : "orchestration";
  return {
    runId: input.forgeRunId,
    input: {
      eventId: `forge:${registration.runtimeId}:${event.id}`,
      producerId: `forge:${registration.runtimeId}`,
      producerEventId: event.id,
      producerSequence: event.seq,
      runtimeId: registration.runtimeId,
      runtimeType: "forge",
      hostRuntimeId: "ava",
      ...actor,
      type: `forge.${event.type}`,
      status: eventStatus(event.type),
      title: event.type.replaceAll(".", " "),
      summary:
        actor.actorRole
          ? `${actor.actorRole} emitted ${event.type}`
          : `Forge emitted ${event.type}`,
      visibility: "summary",
      privacyLevel: "source_sensitive",
      payload: {
        changeId: event.change_id,
        changeSequence: event.change_seq,
        stageRunId: event.stage_run_id,
        roleFamily,
        data: event.payload,
      },
      occurredAt: event.at,
      dedupKey: `forge:${registration.runtimeId}:journal:${event.id}`,
    },
  };
}

/**
 * Accounting rules used by both adapter tests and future ingest:
 *
 * - only a leaf event with `costKind=actual_provider` owns provider cost;
 * - the provider request id is stable across Forge/hosted-Codex forwarding;
 * - only the executor's terminal event uses actionOwner=executor;
 * - parent/runtime rollups are derived at query time and never re-ingested.
 */
export function forgeAccountingIdentity(input: {
  runtimeId: string;
  providerRequestId?: string | null;
  actionId?: string | null;
}): {
  providerRequestId: string | null;
  actionId: string | null;
} {
  return {
    // These are end-to-end leaf identities. Adding the forwarding runtime
    // would make one Codex/provider operation look new when observed by Forge,
    // causing duplicate action, cost and latency accounting.
    providerRequestId: input.providerRequestId ?? null,
    actionId: input.actionId ?? null,
  };
}
