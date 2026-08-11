import type { Db } from "../state/db.js";
import type { VisualExplanationSource } from "../state/visual-explanations.js";
import { createVisualExplanation, listVisualExplanations } from "../state/visual-explanations.js";
import { VisualExplanationValidationError, type CreateVisualExplanationInput } from "../visual-explanations/model.js";
import type { ToolDef } from "./ava-mcp.js";

const storyboardSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1.0"] },
    startSceneId: { type: "string" },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          caption: { type: "string" },
          nodeIds: { type: "array", minItems: 1, maxItems: 14, items: { type: "string" } },
          highlightNodeIds: { type: "array", maxItems: 8, items: { type: "string" } },
          transition: { type: "string", enum: ["none", "fade", "slide"] },
          interactionCue: { type: "string" },
        },
        required: ["id", "title", "caption", "nodeIds", "highlightNodeIds", "transition"],
      },
    },
  },
  required: ["schemaVersion", "startSceneId", "scenes"],
} as const;

export function buildVisualExplanationTools(options: {
  db: Db;
  sessionId: string | null;
  source: Exclude<VisualExplanationSource, "manual">;
}): ToolDef[] {
  return [
    {
      tool: {
        name: "visual_explanation_create",
        description:
          "Create and present an AVA visual explanation. Mermaid is canonical topology. Use only explicit flowchart node declarations on separate lines: processId[\"Label\"], decisionId{\"Question\"}, terminalId([\"Start or result\"]), followed by edges such as processId -->|label| decisionId. Every stable Mermaid node ID must appear in one or more storyboard scenes; each scene may contain at most 14 nodes. The storyboard controls captions, highlights, transitions and interaction cues. Do not add click, href, HTML, style, classDef, linkStyle or initialization directives.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", description: "Concise explanation title." },
            summary: { type: "string", description: "Plain-language overview and purpose." },
            mermaid: { type: "string", description: "Canonical Mermaid flowchart topology with stable explicit node IDs." },
            storyboard: storyboardSchema,
          },
          required: ["title", "summary", "mermaid", "storyboard"],
        },
      },
      run: async (args, ctx) => {
        try {
          const result = createVisualExplanation(options.db, args as unknown as CreateVisualExplanationInput, {
            source: options.source,
            sessionId: options.sessionId,
            runId: ctx.runId,
          });
          return {
            ok: true,
            text: JSON.stringify({
              visualExplanationId: result.visual.id,
              title: result.visual.title,
              created: result.created,
              presentation: "Open in AVA Visuals",
            }),
          };
        } catch (error) {
          const issues = error instanceof VisualExplanationValidationError
            ? error.issues
            : [error instanceof Error ? error.message : "visual explanation could not be created"];
          return { ok: false, text: JSON.stringify({ error: "invalid_visual_explanation", issues }) };
        }
      },
    },
    {
      tool: {
        name: "visual_explanation_list",
        description: "List AVA's recent visual explanations so one can be reopened or referenced without regenerating it.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: 20 } },
        },
      },
      run: async (args) => {
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, Math.trunc(args.limit))) : 10;
        const visuals = listVisualExplanations(options.db, limit).map((visual) => ({
          id: visual.id,
          title: visual.title,
          summary: visual.summary,
          updatedAt: visual.updatedAt,
        }));
        return { ok: true, text: JSON.stringify({ visuals }) };
      },
    },
  ];
}

