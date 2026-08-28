import type { Db } from "../state/db.js";
import { classifyRisk, type Classification, type Tier } from "./classify.js";
import { listRules } from "../state/rules.js";
import { matchRules } from "./rules.js";

export type Enforcement =
  | { decision: "allow" }
  | { decision: "blocked"; reason: string }
  | { decision: "ask"; tier: Tier; classification: Classification };

export function enforce({
  tool,
  args,
  db,
}: {
  tool: string;
  args: unknown;
  db: Db;
}): Enforcement {
  const c = classifyRisk(tool, args);
  if (c.tier === "blocked") return { decision: "blocked", reason: c.reason };

  const rules = listRules(db).filter((r) => r.enabled === 1 && r.status === "active");
  const m = matchRules(rules, tool, args);

  if (m.winning && m.decision === "deny") {
    return { decision: "blocked", reason: `rule: ${m.winning.source}` };
  }
  // A deny rule still wins, but no standing allow rule can turn this
  // experimental action into silent execution. The approval journal remains
  // the single positive authority.
  if (tool === "ufo_experiment_action") {
    return { decision: "ask", tier: "high", classification: c };
  }
  if (m.winning && m.decision === "allow") {
    return { decision: "allow" };
  }

  if (c.tier === "read-only" || c.tier === "low") {
    return { decision: "allow" };
  }

  return { decision: "ask", tier: c.tier, classification: c };
}
