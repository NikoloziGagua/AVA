import type { AutomationPlaybookService } from "../automations/playbooks.js";
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

export function buildAutomationTools(service: AutomationPlaybookService): ToolDef[] {
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
    { tool: { name: "automation_status", description: "Read the truthful per-playbook Activepieces availability and recent AVA-owned automation runs.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      async run() { return { text: JSON.stringify({ health: service.health(), runs: service.list(20) }), ok: true }; } },
  ];
}
