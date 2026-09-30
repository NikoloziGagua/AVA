import type { ResearchVisualForm } from "./research-model.js";

export type VisualRequestSelection = {
  toolMode: "research" | "workflow" | "both";
  explicitForm: ResearchVisualForm | null;
  reason: string;
};

const RESEARCH_CUE = /\b(research|deep dive|deeply|comprehensive report|sources?|citations?|evidence|study|studies|benchmark|dataset|findings)\b/i;

function has(pattern: RegExp, request: string): boolean {
  return pattern.test(request);
}

/**
 * Resolves user-facing visual words before the LLM sees tools. This is an
 * availability boundary, not a content generator: it prevents a request for a
 * timeline/map/chart from silently falling into the cheaper flowchart schema.
 */
export function selectVisualRequest(request: string): VisualRequestSelection {
  const value = request.normalize("NFKC").replace(/\s+/g, " ").trim();
  const research = has(RESEARCH_CUE, value);

  if (has(/\b(evidence[- ]?(?:gap|coverage) (?:map|matrix)|evidence matrix|research gaps?|well[- ]studied|missing research)\b/i, value)) {
    return { toolMode: "research", explicitForm: "evidence_matrix", reason: "The request explicitly asks to compare evidence coverage or research gaps." };
  }
  if (has(/\b(claim[- ]?evidence (?:graph|map)|argument map|evidence graph|counterevidence|supporting sources? and (?:objections?|counterevidence)|disputed points?)\b/i, value)) {
    return { toolMode: "research", explicitForm: "claim_evidence_graph", reason: "The request explicitly asks for claims, support, objections, or counterevidence." };
  }
  if (has(/\b(timeline|time[- ]?line|chronolog(?:y|ical)|turning[- ]point sequence)\b/i, value)) {
    return { toolMode: "research", explicitForm: "timeline", reason: "The request explicitly asks for chronology or a timeline." };
  }
  if (has(/\b(chart|bar graph|line graph|range plot|scatter plot|plot (?:the|these|a)|graph of (?:the|these|values|results))\b/i, value)) {
    return { toolMode: "research", explicitForm: "chart", reason: "The request explicitly asks for a quantitative chart or plot." };
  }

  // Architecture/workflow language wins over the overloaded verb "map" so
  // "map AVA's architecture" remains a process diagram, not a world map.
  if (has(/\b(workflow|flowchart|process(?: diagram)?|system(?: diagram)?|architecture|request path|decision tree|mechanism|components?|dependencies|repository|codebase|how .{1,80}? works|map out (?:the )?(?:process|workflow|system))\b/i, value)) {
    return research
      ? { toolMode: "research", explicitForm: "process", reason: "The researched subject is an explicitly requested mechanism or process." }
      : { toolMode: "workflow", explicitForm: "process", reason: "The request is an operational workflow or system explanation." };
  }
  const explicitGeography = has(/\b(geographic(?:al)? map|world map|regional map)\b/i, value)
    || has(/\bmap\b/i, value);
  if (explicitGeography) {
    return { toolMode: "research", explicitForm: "geographic_map", reason: "The request explicitly depends on real geography, regions, or movement." };
  }

  if (research) {
    return { toolMode: "research", explicitForm: null, reason: "This is a research request, so AVA should select a grounded evidence visual rather than a generic flowchart." };
  }
  return { toolMode: "both", explicitForm: null, reason: "No explicit visual form or research mode was requested." };
}
