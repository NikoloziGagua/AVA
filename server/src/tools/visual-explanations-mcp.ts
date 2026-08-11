import { createHash } from "node:crypto";
import type { Db } from "../state/db.js";
import type { VisualExplanationSource } from "../state/visual-explanations.js";
import { createResearchVisual, createVisualExplanation, listVisualExplanations } from "../state/visual-explanations.js";
import {
  StaleVisualRevisionError,
  VisualExplanationValidationError,
  type CreateVisualExplanationInput,
} from "../visual-explanations/model.js";
import {
  RESEARCH_VISUAL_FORMS,
  validateResearchVisual,
  type CreateResearchVisualInput,
} from "../visual-explanations/research-model.js";
import { selectVisualRequest } from "../visual-explanations/request-selection.js";
import type { ObservabilityService } from "../observability/store.js";
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

const researchEvidenceProperties = {
  claimIds: { type: "array", maxItems: 20, items: { type: "string" } },
  sourceIds: { type: "array", maxItems: 20, items: { type: "string" } },
  confidence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
  evidenceStatus: { type: "string", enum: ["supported", "disputed", "counterevidence", "gap", "context"] },
  uncertainty: { type: ["string", "null"] },
} as const;
const researchEvidenceRequired = ["claimIds", "sourceIds", "confidence", "evidenceStatus", "uncertainty"] as const;

// Provider-facing schema is intentionally explicit. The server repeats deeper
// referential/provenance checks, but this shape prevents the model from having
// to guess the six renderer-neutral contracts in the first place.
const researchSemanticModelSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false,
      properties: {
        kind: { const: "geographic_map" }, projection: { const: "natural-earth-1" },
        locations: { type: "array", minItems: 2, maxItems: 80, items: { type: "object", additionalProperties: false, properties: {
          id: { type: "string" }, label: { type: "string" }, description: { type: "string" }, longitude: { type: "number", minimum: -180, maximum: 180 }, latitude: { type: "number", minimum: -90, maximum: 90 },
          coordinatePrecision: { type: "string", enum: ["exact", "approximate", "regional"] }, uncertaintyKm: { type: ["number", "null"], minimum: 0, maximum: 5000 }, coordinateSourceId: { type: "string" }, periodStart: { type: ["string", "null"] }, periodEnd: { type: ["string", "null"] }, ...researchEvidenceProperties,
        }, required: ["id", "label", "description", "longitude", "latitude", "coordinatePrecision", "uncertaintyKm", "coordinateSourceId", "periodStart", "periodEnd", ...researchEvidenceRequired] } },
        routes: { type: "array", maxItems: 120, items: { type: "object", additionalProperties: false, properties: {
          id: { type: "string" }, from: { type: "string" }, to: { type: "string" }, label: { type: "string" }, direction: { type: "string", enum: ["forward", "bidirectional", "unknown"] }, periodStart: { type: ["string", "null"] }, periodEnd: { type: ["string", "null"] }, ...researchEvidenceProperties,
        }, required: ["id", "from", "to", "label", "direction", "periodStart", "periodEnd", ...researchEvidenceRequired] } },
        regions: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, properties: {
          id: { type: "string" }, label: { type: "string" }, bounds: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } }, periodStart: { type: ["string", "null"] }, periodEnd: { type: ["string", "null"] }, ...researchEvidenceProperties,
        }, required: ["id", "label", "bounds", "periodStart", "periodEnd", ...researchEvidenceRequired] } },
        timeLayers: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, period: { type: "string" }, entityIds: { type: "array", minItems: 1, maxItems: 80, items: { type: "string" } } }, required: ["id", "label", "period", "entityIds"] } },
        legend: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, meaning: { type: "string" } }, required: ["id", "label", "meaning"] } },
      }, required: ["kind", "projection", "locations", "routes", "regions", "timeLayers", "legend"],
    },
    {
      type: "object", additionalProperties: false, properties: {
        kind: { const: "timeline" },
        events: { type: "array", minItems: 2, maxItems: 100, items: { type: "object", additionalProperties: false, properties: {
          id: { type: "string" }, label: { type: "string" }, description: { type: "string" }, dateLabel: { type: "string" }, startYear: { type: ["integer", "null"] }, endYear: { type: ["integer", "null"] }, datePrecision: { type: "string", enum: ["exact", "year", "range", "approximate", "unknown"] }, ...researchEvidenceProperties,
        }, required: ["id", "label", "description", "dateLabel", "startYear", "endYear", "datePrecision", ...researchEvidenceRequired] } },
        links: { type: "array", maxItems: 160, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, from: { type: "string" }, to: { type: "string" }, label: { type: "string" }, kind: { type: "string", enum: ["precedes", "causes", "influences", "overlaps", "disputed"] } }, required: ["id", "from", "to", "label", "kind"] } },
      }, required: ["kind", "events", "links"],
    },
    {
      type: "object", additionalProperties: false, properties: {
        kind: { const: "evidence_matrix" },
        rows: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"] } },
        columns: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"] } },
        cells: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, rowId: { type: "string" }, columnId: { type: "string" }, label: { type: "string" }, coverage: { type: "string", enum: ["strong", "moderate", "weak", "missing", "disputed"] }, detail: { type: "string" }, ...researchEvidenceProperties }, required: ["id", "rowId", "columnId", "label", "coverage", "detail", ...researchEvidenceRequired] } },
      }, required: ["kind", "rows", "columns", "cells"],
    },
    {
      type: "object", additionalProperties: false, properties: {
        kind: { const: "claim_evidence_graph" }, direction: { type: "string", enum: ["TD", "LR"] },
        nodes: { type: "array", minItems: 2, maxItems: 100, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, nodeKind: { type: "string", enum: ["claim", "source", "counterevidence", "objection", "disputed_point", "evidence_gap"] }, description: { type: "string" }, ...researchEvidenceProperties }, required: ["id", "label", "nodeKind", "description", ...researchEvidenceRequired] } },
        relationships: { type: "array", minItems: 1, maxItems: 180, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, from: { type: "string" }, to: { type: "string" }, label: { type: "string" }, kind: { type: "string", enum: ["supports", "contradicts", "qualifies", "objects_to", "leaves_open"] } }, required: ["id", "from", "to", "label", "kind"] } },
      }, required: ["kind", "direction", "nodes", "relationships"],
    },
    {
      type: "object", additionalProperties: false, properties: {
        kind: { const: "chart" }, chartType: { type: "string", enum: ["bar", "line", "range"] }, xLabel: { type: "string" }, yLabel: { type: "string" }, unit: { type: "string" }, zeroBaseline: { type: "boolean" },
        series: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, colorHint: { type: "string", enum: ["cyan", "purple", "amber", "green", "red", "grey"] } }, required: ["id", "label", "colorHint"] } },
        points: { type: "array", minItems: 2, maxItems: 240, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, seriesId: { type: "string" }, x: { type: ["string", "number"] }, value: { type: ["number", "null"] }, low: { type: ["number", "null"] }, high: { type: ["number", "null"] }, label: { type: "string" }, ...researchEvidenceProperties }, required: ["id", "seriesId", "x", "value", "low", "high", "label", ...researchEvidenceRequired] } },
      }, required: ["kind", "chartType", "xLabel", "yLabel", "unit", "series", "points", "zeroBaseline"],
    },
    {
      type: "object", additionalProperties: false, properties: {
        kind: { const: "process" }, direction: { type: "string", enum: ["TD", "TB", "LR", "RL", "BT"] },
        elements: { type: "array", minItems: 2, maxItems: 80, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, label: { type: "string" }, elementKind: { type: "string", enum: ["process", "decision", "terminal"] }, description: { type: "string" }, ...researchEvidenceProperties }, required: ["id", "label", "elementKind", "description", ...researchEvidenceRequired] } },
        relationships: { type: "array", minItems: 1, maxItems: 160, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, from: { type: "string" }, to: { type: "string" }, label: { type: ["string", "null"] }, kind: { type: "string", enum: ["flow", "dotted", "strong"] } }, required: ["id", "from", "to", "label", "kind"] } },
      }, required: ["kind", "direction", "elements", "relationships"],
    },
  ],
} as const;

export function buildVisualExplanationTools(options: {
  db: Db;
  sessionId: string | null;
  source: Exclude<VisualExplanationSource, "manual">;
  observability?: ObservabilityService;
  request?: string;
}): ToolDef[] {
  const routing = selectVisualRequest(options.request ?? "");
  const tools: ToolDef[] = [
    {
      tool: {
        name: "visual_explanation_create",
        description:
          "Create or conversationally revise an inline AVA workflow/process VisualMessage. Use this only for operational workflows, architectures, mechanisms, request paths, or branching decisions. Never use this flowchart contract for geographic maps, timelines, evidence matrices, claim-evidence graphs, quantitative charts, or research results; those require research_visual_create. Prefer semanticModel: stable element and relationship IDs are canonical, while the storyboard references element IDs. Restricted Mermaid remains a backward-compatible ingest alternative and is converted to the semantic model. Every element must appear in a scene. To revise (for example 'add the database' or 'show only auth'), send the complete revised model plus revisesVisualMessageId and expectedRevision. Never add active links, HTML, scripts or renderer directives.",
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
        name: "research_visual_create",
        description:
          "Create a first-class evidence-linked visual for a substantial research result and present it inline. Use after multi-source research, or whenever Sir asks for deep research with a visual. Choose geographic_map for real movement/regions (longitude/latitude plus coordinate sources), timeline for chronology, evidence_matrix for coverage/gaps, claim_evidence_graph for claims/support/counterevidence, chart for sourced quantities/ranges, or process for mechanisms. Omit userSelectedForm for AVA's automatic selection; set it only when Sir explicitly chose the form. Every claim and visual entity has stable IDs and source/claim references, every entity appears in a progressive scene, uncertainty remains explicit, and all URLs must be direct http(s) sources. Never invent coordinates, dates, quantities, confidence or citations." +
          (routing.explicitForm
            ? ` This request explicitly requires ${routing.explicitForm}; use that exact semanticModel kind and set userSelectedForm to ${routing.explicitForm}.`
            : ""),
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            question: { type: "string", description: "The research question used for automatic visual-form selection." },
            userSelectedForm: { type: ["string", "null"], enum: [...RESEARCH_VISUAL_FORMS, null], description: "Set only when Sir explicitly requested this form." },
            synthesis: { type: "string" },
            methodology: { type: "string" },
            limitations: { type: "array", maxItems: 20, items: { type: "string" } },
            sources: {
              type: "array", minItems: 1, maxItems: 80,
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  id: { type: "string" }, title: { type: "string" }, url: { type: "string" },
                  publisher: { type: ["string", "null"] }, publishedAt: { type: ["string", "null"] },
                  quality: { type: "string", enum: ["primary", "scholarly", "official", "reputable_secondary", "other", "unknown"] },
                  qualityNote: { type: ["string", "null"] },
                },
                required: ["id", "title", "url", "publisher", "publishedAt", "quality", "qualityNote"],
              },
            },
            claims: {
              type: "array", minItems: 1, maxItems: 100,
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  id: { type: "string" }, text: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low", "unknown"] },
                  status: { type: "string", enum: ["supported", "disputed", "uncertain", "missing_evidence"] },
                  sourceIds: { type: "array", items: { type: "string" } },
                  counterSourceIds: { type: "array", items: { type: "string" } },
                  limitation: { type: ["string", "null"] },
                },
                required: ["id", "text", "confidence", "status", "sourceIds", "counterSourceIds", "limitation"],
              },
            },
            semanticModel: researchSemanticModelSchema,
            storyboard: {
              type: "object", additionalProperties: false,
              properties: {
                schemaVersion: { type: "string", enum: ["2.0"] },
                startSceneId: { type: "string" },
                scenes: {
                  type: "array", minItems: 1, maxItems: 24,
                  items: {
                    type: "object", additionalProperties: false,
                    properties: {
                      id: { type: "string" }, title: { type: "string" }, caption: { type: "string" },
                      entityIds: { type: "array", minItems: 1, maxItems: 14, items: { type: "string" } },
                      highlightEntityIds: { type: "array", maxItems: 8, items: { type: "string" } },
                      sourceIds: { type: "array", maxItems: 20, items: { type: "string" } },
                      transition: { type: "string", enum: ["none", "fade", "slide"] }, interactionCue: { type: "string" },
                    },
                    required: ["id", "title", "caption", "entityIds", "highlightEntityIds", "sourceIds", "transition"],
                  },
                },
              },
              required: ["schemaVersion", "startSceneId", "scenes"],
            },
            revisesVisualMessageId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 },
          },
          required: ["title", "summary", "question", "synthesis", "methodology", "limitations", "sources", "claims", "semanticModel", "storyboard"],
        },
      },
      run: async (args, ctx) => {
        const statedForm = typeof args.userSelectedForm === "string" ? args.userSelectedForm : null;
        if (routing.explicitForm && statedForm && statedForm !== routing.explicitForm) {
          return { ok: false, text: JSON.stringify({
            error: "requested_visual_form_mismatch",
            requestedForm: routing.explicitForm,
            receivedForm: statedForm,
          }) };
        }
        const routedArgs = routing.explicitForm
          ? { ...args, userSelectedForm: routing.explicitForm }
          : args;
        const inputKey = createHash("sha256").update(JSON.stringify(routedArgs)).digest("hex").slice(0, 16);
        const observe = (stage: string, status: string, title: string, payload?: unknown, error?: string) => {
          try {
            options.observability?.record(ctx.runId, {
              producerId: "ava:research-visual",
              producerEventId: `research-visual:${inputKey}:${stage}`,
              dedupKey: `research-visual:${ctx.runId}:${inputKey}:${stage}`,
              type: `research.visual.${stage}`,
              status,
              title,
              visibility: stage === "planning" ? "sensitive_collapsed" : "detail",
              privacyLevel: stage === "planning" ? "source_sensitive" : "personal",
              payload,
              error,
            });
          } catch { /* the research result always wins over its telemetry */ }
        };
        try {
          const valid = validateResearchVisual(routedArgs as unknown as CreateResearchVisualInput);
          observe("planning", "running", "Research visual form selected", {
            selectedForm: valid.selection.selectedForm,
            recommendedForm: valid.selection.recommendedForm,
            userSelected: valid.selection.userSelected,
            sourceCount: valid.sources.length,
            claimCount: valid.claims.length,
          });
          observe("validated", "completed", "Research evidence and visual structure validated", {
            form: valid.diagramKind,
            sceneCount: valid.storyboard.scenes.length,
            limitationsRecorded: valid.limitations.length,
          });
          const result = createResearchVisual(options.db, routedArgs as unknown as CreateResearchVisualInput, {
            source: options.source,
            sessionId: options.sessionId,
            runId: ctx.runId,
          });
          observe("persisted", "completed", "Research visual attached to the result", {
            visualMessageId: result.visual.visualMessageId,
            revision: result.visual.revision,
            form: result.visual.diagramKind,
            created: result.created,
            evidence: "validated canonical revision",
          });
          return { ok: true, text: JSON.stringify({
            visualMessageId: result.visual.visualMessageId,
            visualExplanationId: result.visual.visualMessageId,
            revision: result.visual.revision,
            title: result.visual.title,
            visualForm: result.visual.diagramKind,
            recommendedForm: result.visual.selection.recommendedForm,
            created: result.created,
            presentation: "Inline beneath AVA's research synthesis",
          }) };
        } catch (error) {
          const issues = error instanceof VisualExplanationValidationError
            ? error.issues
            : [error instanceof Error ? error.message : "research visual could not be created"];
          observe("failed", "error", "Research visual generation failed safely", { issueCount: issues.length }, issues[0]);
          if (error instanceof StaleVisualRevisionError) return { ok: false, text: JSON.stringify({ error: "stale_visual_revision", currentRevision: error.currentRevision }) };
          return { ok: false, text: JSON.stringify({ error: "invalid_research_visual", issues }) };
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
  const workflow = tools.find((entry) => entry.tool.name === "visual_explanation_create")!;
  const research = tools.find((entry) => entry.tool.name === "research_visual_create")!;
  const list = tools.find((entry) => entry.tool.name === "visual_explanation_list")!;
  if (routing.toolMode === "research") return [research, list];
  if (routing.toolMode === "workflow") return [workflow, list];
  // Keep both tools for genuinely ambiguous turns, but put the richer
  // form-selecting contract first so it is not shadowed by flowchart input.
  return [research, workflow, list];
}
