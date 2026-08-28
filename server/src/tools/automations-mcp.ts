import type { SystemReportAutomationService } from "../automations/system-report.js";
import type { ToolDef } from "./ava-mcp.js";

export function buildAutomationTools(service: SystemReportAutomationService): ToolDef[] {
  return [
    { tool: { name: "automation_system_report", description: "Run AVA's pinned Activepieces system-health playbook. AVA independently verifies the generated local Markdown artifact before reporting success.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      async run(_args, ctx) {
        const run = await service.run({ requestKey: `${ctx.runId}:ava.system-report:v1`, parentRunId: ctx.runId, signal: ctx.signal });
        return { text: JSON.stringify(run), ok: run.status === "completed",
          verification: run.status === "completed" ? { state: "verified", scope: "task_outcome", method: "filesystem_readback_sha256",
            summary: "AVA read back and hash-verified the generated report artifact.", evidenceRef: run.id, observedAt: run.completedAt ?? undefined }
            : { state: "unavailable", scope: "task_outcome", method: "filesystem_readback_sha256",
              summary: run.errorMessage ?? `Automation ended ${run.status}.`, evidenceRef: run.id } };
      } },
    { tool: { name: "automation_status", description: "Read the truthful Activepieces playbook availability and recent AVA-owned automation runs.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      async run() { return { text: JSON.stringify({ health: service.health(), runs: service.list(10) }), ok: true }; } },
  ];
}
