import { describe, expect, it } from "vitest";
import {
  FORGE_AGENT_ROLES,
  forgeAccountingIdentity,
  mapForgeJournalEvent,
} from "./forge-adapter.js";

describe("Forge observability adapter contract", () => {
  it("preserves Forge journal identity, causality and an extensible agent role", () => {
    const mapped = mapForgeJournalEvent({
      registration: {
        adapterVersion: 1,
        runtimeId: "forge-runtime-1",
        forgeInstanceId: "forge-local",
        avaContext: {
          traceId: "trace-1",
          parentRunId: "ava-task-1",
        },
        changeId: "change-1",
        roles: [...FORGE_AGENT_ROLES, "future-specialist"],
        acknowledgedSequence: 40,
      },
      forgeRunId: "forge-run-1",
      event: {
        seq: 41,
        change_seq: 9,
        id: "journal-event-41",
        type: "stage.started",
        change_id: "change-1",
        stage_run_id: "stage-2",
        actor: {
          kind: "agent",
          agent: "future-specialist",
          run_id: "agent-run-2",
        },
        at: 1_000,
        payload: { safe: true },
      },
    });

    expect(mapped.runId).toBe("forge-run-1");
    expect(mapped.input).toMatchObject({
      eventId: "forge:forge-runtime-1:journal-event-41",
      producerId: "forge:forge-runtime-1",
      producerEventId: "journal-event-41",
      producerSequence: 41,
      runtimeType: "forge",
      hostRuntimeId: "ava",
      actorType: "agent",
      actorId: "agent-run-2",
      actorRole: "future-specialist",
      type: "forge.stage.started",
      privacyLevel: "source_sensitive",
      dedupKey: "forge:forge-runtime-1:journal:journal-event-41",
    });
  });

  it("keeps canonical provider/action ids unchanged across nested forwarding", () => {
    const fromCodex = forgeAccountingIdentity({
      runtimeId: "codex-hosted",
      providerRequestId: "openai-response-9",
      actionId: "logical-action-9",
    });
    const fromForge = forgeAccountingIdentity({
      runtimeId: "forge-runtime",
      providerRequestId: "openai-response-9",
      actionId: "logical-action-9",
    });
    expect(fromCodex).toEqual(fromForge);
  });
});

