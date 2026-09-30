import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import { scrubSecrets } from "../security/scrub.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import {
  generatedDefinitionSteps,
  generatedStepArgs,
  type GeneratedPlaybookActionResult,
  type GeneratedPlaybookDefinition,
  type GeneratedSequenceStep,
} from "./generated-playbooks.js";

export const GENERATED_PLAYBOOK_TOOL_NAMES = [
  "chrome_open_url",
  "chrome_google_search",
  "chrome_youtube_search",
  "instagram_open_chat",
  "instagram_read_chat",
] as const satisfies readonly GeneratedSequenceStep["tool"][];

type StepEvidence = NonNullable<GeneratedPlaybookActionResult["steps"]>[number];

/** Build one closed executor from AVA's authoritative tool definitions. The
 * generated definition selects only tools in the explicit registry; it never
 * supplies code, selectors, shell, sends, typing, or another workflow ID. */
export function buildGeneratedPlaybookExecutor(tools: ToolDef[]): (
  definition: GeneratedPlaybookDefinition,
  signal?: AbortSignal,
  executionId?: string,
) => Promise<GeneratedPlaybookActionResult> {
  const supported = new Set<string>(GENERATED_PLAYBOOK_TOOL_NAMES);
  const allowed = new Map<string, ToolDef>();
  for (const tool of tools) {
    if (!supported.has(tool.tool.name)) continue;
    if (allowed.has(tool.tool.name)) throw new Error(`duplicate generated-playbook executor: ${tool.tool.name}`);
    allowed.set(tool.tool.name, tool);
  }

  return async (definition, signal, executionId) => {
    const evidence: StepEvidence[] = [];
    let lastText = "";
    for (const step of generatedDefinitionSteps(definition)) {
      if (signal?.aborted) {
        return { ok: false, text: "AVA cancelled the approved playbook before the next local step.", steps: evidence };
      }
      const tool = allowed.get(step.tool);
      if (!tool) return { ok: false, text: `Approved step ${step.id} is unavailable.`, steps: evidence };
      const result = await tool.run(generatedStepArgs(step), {
        runId: `generated-${executionId ?? "unscoped"}:${step.id}`,
        signal,
      });
      const summary = result.ok
        ? `${step.tool} completed${result.verification?.state === "verified" ? " and verified" : " without verification"}.`
        : `${step.tool} failed.`;
      evidence.push({ id: step.id, tool: step.tool, ok: result.ok, summary,
        ...(result.verification ? { verification: result.verification } : {}) });
      lastText = scrubSecrets(result.text).slice(0, 12_000);
      if (!result.ok || result.verification?.state !== "verified") {
        return {
          ok: false,
          text: result.ok
            ? `Approved step ${step.id} completed but did not produce independent verification.`
            : `Approved step ${step.id} failed: ${lastText}`,
          steps: evidence,
          ...(result.verification ? { verification: result.verification } : {}),
        };
      }
    }
    const only = evidence.length === 1 ? evidence[0] : null;
    const aggregate: ToolVerificationEvidence = {
      state: "verified",
      scope: "task_outcome",
      method: "approved_playbook_sequence",
      summary: `AVA completed and independently verified all ${evidence.length} approved playbook steps in order.`,
      observedAt: Date.now(),
    };
    return {
      ok: true,
      text: lastText || `Completed and verified ${evidence.length} approved steps.`,
      steps: evidence,
      verification: only?.verification ?? aggregate,
    };
  };
}
