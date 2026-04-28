import picomatch from "picomatch";
import type { Rule } from "../state/rules.js";

export type ParsedRule = {
  match: {
    tool?: string;
    "args.cwd"?: string[];
    "args.path"?: string[];
    "args.command"?: string[];
  };
  action: "allow" | "deny" | "ask";
};

export type MatchResult = {
  decision: "allow" | "deny" | "ask" | null;
  winning: Rule | null;
};

/** Count path separators (/ or \) in a string — used for specificity depth bonus. */
function countSegments(pattern: string): number {
  let count = 0;
  for (const ch of pattern) {
    if (ch === "/" || ch === "\\") count++;
  }
  return count;
}

/**
 * Score how specifically a rule matches the given tool + args.
 * Returns null if the rule does NOT match at all.
 */
function scoreRule(
  parsed: ParsedRule,
  tool: string,
  args: Record<string, unknown>,
): number | null {
  let score = 0;

  // --- Tool matching ---
  const toolPattern = parsed.match.tool;
  if (toolPattern !== undefined && toolPattern !== "*" && toolPattern !== "") {
    // There's a concrete tool requirement — check it
    if (toolPattern === tool) {
      score += 10; // exact match bonus
    } else {
      // Try glob match (e.g. "shell*")
      const isMatch = picomatch(toolPattern, { nocase: false });
      if (!isMatch(tool)) {
        return null; // tool doesn't match, rule doesn't apply
      }
      // Glob match on tool: no +10, but still counts as a match
    }
  }
  // toolPattern absent / "*" / "" → wildcard, score += 0

  // --- Args matching ---
  const ARG_KEYS = ["args.cwd", "args.path", "args.command"] as const;
  for (const key of ARG_KEYS) {
    const patterns = parsed.match[key];
    if (!patterns || patterns.length === 0) continue;

    // The arg field name strips the "args." prefix
    const argName = key.slice("args.".length); // "cwd" | "path" | "command"
    const argValue = args[argName];
    if (typeof argValue !== "string") continue; // no value → no match on this key

    // ANY one pattern matching is sufficient; each matching pattern contributes score
    let argMatched = false;
    for (const pattern of patterns) {
      const isMatch = picomatch(pattern, { dot: true, nocase: true });
      if (isMatch(argValue)) {
        argMatched = true;
        score += 1 + countSegments(pattern);
      }
    }

    if (!argMatched) {
      // The rule specifies a constraint on this arg but value doesn't match → rule doesn't apply
      return null;
    }
  }

  return score;
}

export function matchRules(rules: Rule[], tool: string, args: unknown): MatchResult {
  const argsObj = (args && typeof args === "object" && !Array.isArray(args))
    ? (args as Record<string, unknown>)
    : {};

  let bestScore = -Infinity;
  let bestCreatedAt = -Infinity;
  let winning: Rule | null = null;

  for (const rule of rules) {
    if (!rule.parsed) continue;

    let parsed: ParsedRule;
    try {
      parsed = JSON.parse(rule.parsed) as ParsedRule;
    } catch {
      continue; // skip invalid JSON silently
    }

    const score = scoreRule(parsed, tool, argsObj);
    if (score === null) continue; // rule didn't match

    // Higher score wins; ties broken by most recent created_at
    if (
      score > bestScore ||
      (score === bestScore && rule.created_at > bestCreatedAt)
    ) {
      bestScore = score;
      bestCreatedAt = rule.created_at;
      winning = rule;
    }
  }

  if (!winning) return { decision: null, winning: null };

  const parsed = JSON.parse(winning.parsed!) as ParsedRule;
  return { decision: parsed.action, winning };
}
