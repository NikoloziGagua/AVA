import type { Db } from "../state/db.js";
import type { VisualExplanationSource } from "../state/visual-explanations.js";
import { createVisualExplanation, listVisualExplanations } from "../state/visual-explanations.js";
import {
  StaleVisualRevisionError,
  VisualExplanationValidationError,
  type CreateVisualExplanationInput,
} from "../visual-explanations/model.js";
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

const semanticModelSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    direction: { type: "string", enum: ["TD", "TB", "LR", "RL", "BT"] },
    elements: {
      type: "array",
      minItems: 2,
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          kind: { type: "string", enum: ["process", "decision", "terminal"] },
        },
        required: ["id", "label", "kind"],
      },
    },
    relationships: {
      type: "array",
      minItems: 1,
      maxItems: 160,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          label: { type: ["string", "null"] },
          kind: { type: "string", enum: ["flow", "dotted", "strong"] },
        },
        required: ["id", "from", "to", "label", "kind"],
      },
    },
  },
  required: ["direction", "elements", "relationships"],
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
          "Create or conversationally revise an inline AVA VisualMessage. Prefer semanticModel: stable element and relationship IDs are canonical, while the storyboard references element IDs. Restricted Mermaid remains a backward-compatible ingest alternative and is converted to the semantic model. Every element must appear in a scene. To revise (for example 'add the database' or 'show only auth'), send the complete revised model plus revisesVisualMessageId and expectedRevision. Never add active links, HTML, scripts or renderer directives.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", description: "Concise explanation title." },
            summary: { type: "string", description: "Plain-language overview and purpose." },
            diagramKind: { type: "string", enum: ["flowchart"] },
            semanticModel: semanticModelSchema,
            mermaid: { type: "string", description: "Backward-compatible restricted Mermaid ingest with stable explicit node IDs; AVA converts it to the canonical semantic model." },
            storyboard: storyboardSchema,
            revisesVisualMessageId: { type: "string", description: "Existing visual message ID when creating a conversational revision." },
            expectedRevision: { type: "integer", minimum: 1, description: "Revision the new visual is based on; stale revisions are rejected." },
          },
          required: ["title", "summary", "storyboard"],
          anyOf: [{ required: ["semanticModel"] }, { required: ["mermaid"] }],
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
              visualExplanationId: result.visual.visualMessageId,
              visualMessageId: result.visual.visualMessageId,
              revision: result.visual.revision,
              title: result.visual.title,
              created: result.created,
              presentation: "Inline beneath AVA's reply",
            }),
          };
        } catch (error) {
          if (error instanceof StaleVisualRevisionError) {
            return {
              ok: false,
              text: JSON.stringify({ error: "stale_visual_revision", currentRevision: error.currentRevision }),
            };
          }
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
          id: visual.visualMessageId,
          visualMessageId: visual.visualMessageId,
          revision: visual.revision,
          title: visual.title,
          summary: visual.summary,
          updatedAt: visual.createdAt,
        }));
        return { ok: true, text: JSON.stringify({ visuals }) };
      },
    },
  ];
}
