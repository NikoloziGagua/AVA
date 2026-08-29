import type { AutomationPlaybookService } from "../automations/playbooks.js";
import { GeneratedPlaybookError, type GeneratedPlaybookService } from "../automations/generated-playbooks.js";
import type { AutomationWorkflowId } from "../automations/types.js";
import type { ToolDef } from "./ava-mcp.js";

function actionTool(
  service: AutomationPlaybookService,
  input: { name: string; workflowId: AutomationWorkflowId; description: string },
): ToolDef {
  return {
    tool: { name: input.name, description: input.description,
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    async run(_args, ctx) {
      const run = await service.run(input.workflowId, {
        requestKey: `${ctx.runId}:${input.workflowId}:v1`, parentRunId: ctx.runId, signal: ctx.signal,
      });
      return { text: JSON.stringify(run), ok: run.status === "completed",
        verification: run.status === "completed" ? {
          state: "verified", scope: "task_outcome", method: "filesystem_readback_sha256",
          summary: "AVA read back and hash-verified the generated automation artifact.",
          evidenceRef: run.id, observedAt: run.completedAt ?? undefined,
        } : {
          state: "unavailable", scope: "task_outcome", method: "filesystem_readback_sha256",
          summary: run.errorMessage ?? `Automation ended ${run.status}.`, evidenceRef: run.id,
        } };
    },
  };
}

export function buildAutomationTools(
  service: AutomationPlaybookService,
  generated?: GeneratedPlaybookService,
): ToolDef[] {
  return [
    actionTool(service, {
      name: "automation_system_report",
      workflowId: "ava.system-report",
      description: "Run AVA's pinned Activepieces system-health playbook. AVA independently verifies the generated local Markdown artifact before reporting success.",
    }),
    actionTool(service, {
      name: "automation_operations_brief",
      workflowId: "ava.operations-brief",
      description: "Run AVA's pinned Activepieces operations-brief playbook over bounded non-secret counts for recent runs, verification, approvals, Self, watches, Notes, and memory. AVA independently verifies the local Markdown artifact.",
    }),
    { tool: { name: "automation_status", description: "Read truthful per-workflow Activepieces availability, recent runs, automatically observed playbook candidates, and approved generated playbooks.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      async run() { return { text: JSON.stringify({ health: service.health(), runs: service.list(20),
        generated: generated ? { candidates: generated.list(), active: generated.active() } : { candidates: [], active: [] } }), ok: true }; } },
    ...(generated ? [
      {
        tool: {
          name: "automation_playbook_activate",
          description: "Validate and activate one automatically proposed playbook. This requires an explicit approval card. Use the candidate ID and current version returned by automation_status; stale versions are rejected.",
          inputSchema: {
            type: "object",
            properties: {
              candidateId: { type: "string", pattern: "^automation_candidate_[a-f0-9]{18}$" },
              expectedVersion: { type: "integer", minimum: 1 },
            },
            required: ["candidateId", "expectedVersion"],
            additionalProperties: false,
          },
        },
        async run(args: Record<string, unknown>, ctx: Parameters<ToolDef["run"]>[1]) {
          try {
            const candidate = await generated.activate({
              candidateId: String(args.candidateId ?? ""),
              expectedVersion: Number(args.expectedVersion),
              parentRunId: ctx.runId,
              signal: ctx.signal,
            });
            return { ok: true, text: JSON.stringify(candidate), verification: {
              state: "verified" as const,
              scope: "task_outcome" as const,
              method: "activepieces_plan_readback_sha256",
              summary: "AVA validated the approved definition through Activepieces and published only the exact version reviewed by Niko.",
              evidenceRef: candidate.validationRunId ?? candidate.id,
              observedAt: candidate.activatedAt ?? undefined,
            } };
          } catch (error) {
            const code = error instanceof GeneratedPlaybookError ? error.code : "activation_failed";
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, text: JSON.stringify({ code, message }) };
          }
        },
      } satisfies ToolDef,
      {
        tool: {
          name: "automation_run_playbook",
          description: "Run one active, explicitly approved generated playbook by its exact playbook ID. Activepieces first returns a verified bounded plan; AVA then revalidates current identity data, runs the allowlisted local action, and reports the action's own evidence.",
          inputSchema: {
            type: "object",
            properties: { playbookId: { type: "string", pattern: "^ava\\.learned\\.[a-z0-9][a-z0-9.-]{2,96}$" } },
            required: ["playbookId"],
            additionalProperties: false,
          },
        },
        async run(args: Record<string, unknown>, ctx: Parameters<ToolDef["run"]>[1]) {
          try {
            const execution = await generated.run({
              playbookId: String(args.playbookId ?? ""),
              requestKey: `${ctx.runId}:${String(args.playbookId ?? "")}`,
              parentRunId: ctx.runId,
              signal: ctx.signal,
            });
            return { ok: execution.result.ok, text: JSON.stringify({
              playbookId: execution.candidate.playbookId,
              revision: execution.candidate.revision,
              planRunId: execution.planRunId,
              result: execution.result.text,
            }), ...(execution.result.verification ? { verification: execution.result.verification } : {}) };
          } catch (error) {
            const code = error instanceof GeneratedPlaybookError ? error.code : "playbook_run_failed";
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, text: JSON.stringify({ code, message }) };
          }
        },
      } satisfies ToolDef,
    ] : []),
  ];
}
