import type { UfoExperimentService, UfoFixtureId } from "../ufo/experiment.js";
import { UfoExperimentError } from "../ufo/experiment.js";
import type { ToolDef } from "./ava-mcp.js";

const fixtureSchema = { type: "string", enum: ["counter-v1"] } as const;

function requestKey(runId: string, operation: "observe" | "advance" | "execute", fixtureId: UfoFixtureId, version: number): string {
  return `${runId}:${operation}:${fixtureId}:${version}`;
}

function failure(error: unknown) {
  const known = error instanceof UfoExperimentError;
  return {
    text: `${known ? error.code : "ufo_experiment_failed"}: ${error instanceof Error ? error.message : String(error)}`,
    ok: false,
  };
}

export function buildUfoExperimentTools(service: UfoExperimentService): ToolDef[] {
  const tools: ToolDef[] = [
    {
      tool: {
        name: "ufo_experiment_status",
        description: "Read the truthful status of AVA's Microsoft UFO experiment, including whether the synthetic counter or pinned genuine Notepad runtime is actually available.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      async run() { return { text: JSON.stringify(service.health()), ok: true }; },
    },
    {
      tool: {
        name: "ufo_experiment_observe",
        description: "Observe AVA's disposable counter fixture without changing it. This never touches the host desktop, files, browser, clipboard, accounts, network, or Microsoft UFO runtime.",
        inputSchema: {
          type: "object", additionalProperties: false,
          properties: { fixtureId: fixtureSchema, maxSteps: { type: "integer", minimum: 1, maximum: 5 } },
          required: ["fixtureId"],
        },
      },
      async run(args, ctx) {
        try {
          const fixtureVersion = service.fixtureState(String(args.fixtureId) as UfoFixtureId).version;
          const result = await service.run({ requestKey: requestKey(ctx.runId, "observe", "counter-v1", fixtureVersion),
            fixtureId: String(args.fixtureId) as UfoFixtureId, operation: "observe",
            ...(args.maxSteps === undefined ? {} : { maxSteps: Number(args.maxSteps) }) },
          { parentRunId: ctx.runId, signal: ctx.signal });
          return {
            text: JSON.stringify(result), ok: result.status === "completed",
            verification: result.status === "completed" ? {
              state: "verified" as const, scope: "operation" as const, method: "ufo_synthetic_fixture_read",
              summary: "AVA read the versioned disposable fixture state without host access.",
              evidenceRef: result.id, observedAt: result.completedAt ?? undefined,
            } : {
              state: "unavailable" as const, scope: "operation" as const, method: "ufo_synthetic_fixture_read",
              summary: result.errorMessage ?? "Fixture evidence was unavailable.", evidenceRef: result.id,
            },
          };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "ufo_experiment_action",
        description: "Advance only AVA's disposable counter fixture by one step. This EXPERIMENTAL action always requires Sir's explicit approval, a current fixture version, enabled fixture actions, and the strict allowlist. It cannot control the host or Microsoft UFO.",
        inputSchema: {
          type: "object", additionalProperties: false,
          properties: { fixtureId: fixtureSchema, expectedFixtureVersion: { type: "integer", minimum: 1 },
            maxSteps: { type: "integer", minimum: 1, maximum: 5 } },
          required: ["fixtureId", "expectedFixtureVersion"],
        },
      },
      async run(args, ctx) {
        try {
          const expectedVersion = Number(args.expectedFixtureVersion);
          const result = await service.run({ requestKey: requestKey(ctx.runId, "advance", "counter-v1", expectedVersion),
            fixtureId: String(args.fixtureId) as UfoFixtureId, operation: "advance",
            expectedFixtureVersion: expectedVersion,
            ...(args.maxSteps === undefined ? {} : { maxSteps: Number(args.maxSteps) }) },
          { parentRunId: ctx.runId, signal: ctx.signal });
          return {
            text: JSON.stringify(result), ok: result.status === "completed",
            verification: result.status === "completed" ? {
              state: "verified" as const, scope: "operation" as const, method: "ufo_synthetic_fixture_cas",
              summary: "AVA committed exactly one version-guarded change to the disposable fixture.",
              evidenceRef: result.id, observedAt: result.completedAt ?? undefined,
            } : {
              state: "unavailable" as const, scope: "operation" as const, method: "ufo_synthetic_fixture_cas",
              summary: result.errorMessage ?? "Fixture action evidence was unavailable.", evidenceRef: result.id,
            },
          };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "ufo_runtime_run",
        description: "Run genuine pinned Microsoft UFO only on AVA's disposable Notepad proof fixture. The text and target are fixed, Sir's explicit approval is always required, and AVA independently verifies the visible result. This is not arbitrary computer control.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      async run(_args, ctx) {
        try {
          const result = await service.run({
            requestKey: requestKey(ctx.runId, "execute", "notepad-text-v1", 1),
            fixtureId: "notepad-text-v1",
            operation: "execute",
          }, { parentRunId: ctx.runId, signal: ctx.signal });
          return {
            text: JSON.stringify(result),
            ok: result.status === "completed",
            verification: result.status === "completed" ? {
              state: "verified" as const,
              scope: "operation" as const,
              method: "microsoft_ufo_windows_uia",
              summary: "Microsoft UFO executed the fixed Notepad task and a separate UI Automation read verified the exact visible text.",
              evidenceRef: result.id,
              observedAt: result.completedAt ?? undefined,
            } : {
              state: "unavailable" as const,
              scope: "operation" as const,
              method: "microsoft_ufo_windows_uia",
              summary: result.errorMessage ?? "Real runtime evidence was unavailable.",
              evidenceRef: result.id,
            },
          };
        } catch (error) { return failure(error); }
      },
    },
  ];
  // Do not advertise a mutation the configured runtime cannot perform. The
  // status/observe tools stay available so AVA can explain the fail-closed
  // state, but there is no fake action control while observe-only or offline.
  const health = service.health();
  if (health.mode === "ufo") return health.actionsAvailable ? [tools[0]!, tools[3]!] : [tools[0]!];
  return health.actionsAvailable ? tools.slice(0, 3) : tools.slice(0, 2);
}
