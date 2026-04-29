import type { ReasoningLevel } from "../state/reasoning-pref.js";

export type AgentMode = "conversation" | "action";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export function mapReasoning(level: ReasoningLevel, mode: AgentMode): ReasoningEffort {
  if (level === "fast")     return mode === "conversation" ? "minimal" : "low";
  /* thorough */            return mode === "conversation" ? "low"     : "medium";
}
