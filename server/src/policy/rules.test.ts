import { describe, it, expect } from "vitest";
import { matchRules } from "./rules.js";
import type { Rule } from "../state/rules.js";

function rule(parsed: object, opts: Partial<Rule> = {}): Rule {
  return {
    id: opts.id ?? Math.random().toString(36).slice(2, 10),
    source: opts.source ?? "src",
    parsed: JSON.stringify(parsed),
    enabled: 1,
    status: "active",
    created_at: opts.created_at ?? 1000,
    updated_at: opts.updated_at ?? 1000,
  };
}

describe("matchRules", () => {
  it("returns null when no rules match", () => {
    const r = matchRules([], "shell", { command: "ls" });
    expect(r).toEqual({ decision: null, winning: null });
  });

  it("returns null when rule is for a different tool", () => {
    const rules = [rule({ match: { tool: "fs_read" }, action: "allow" })];
    expect(matchRules(rules, "shell", {}).decision).toBe(null);
  });

  it("matches a deny rule on exact tool", () => {
    const rules = [rule({ match: { tool: "shell" }, action: "deny" })];
    const r = matchRules(rules, "shell", { command: "rm" });
    expect(r.decision).toBe("deny");
    expect(r.winning?.id).toBe(rules[0]!.id);
  });

  it("exact tool beats wildcard tool", () => {
    const wildcard = rule({ match: { tool: "*" }, action: "deny" }, { id: "w" });
    const exact = rule({ match: { tool: "shell" }, action: "allow" }, { id: "e" });
    const r = matchRules([wildcard, exact], "shell", {});
    expect(r.decision).toBe("allow");
    expect(r.winning?.id).toBe("e");
  });

  it("deeper path pattern wins over shallow match", () => {
    const shallow = rule({ match: { tool: "fs_read", "args.path": ["C:/ai/**"] }, action: "ask" }, { id: "s" });
    const deep = rule({ match: { tool: "fs_read", "args.path": ["C:/ai/secrets/**/*.txt"] }, action: "deny" }, { id: "d" });
    const r = matchRules([shallow, deep], "fs_read", { path: "C:/ai/secrets/inner/x.txt" });
    expect(r.decision).toBe("deny");
    expect(r.winning?.id).toBe("d");
  });

  it("ties broken by most recent (created_at)", () => {
    const older = rule({ match: { tool: "shell" }, action: "deny" }, { id: "old", created_at: 1000 });
    const newer = rule({ match: { tool: "shell" }, action: "allow" }, { id: "new", created_at: 2000 });
    const r = matchRules([older, newer], "shell", {});
    expect(r.winning?.id).toBe("new");
  });

  it("skips rules with invalid JSON parsed", () => {
    const bad: Rule = {
      id: "bad", source: "x", parsed: "{not json", enabled: 1, status: "active",
      created_at: 1, updated_at: 1,
    };
    const ok = rule({ match: { tool: "shell" }, action: "allow" }, { id: "ok" });
    const r = matchRules([bad, ok], "shell", {});
    expect(r.winning?.id).toBe("ok");
  });

  it("matches by args.command substring with picomatch glob", () => {
    const rules = [rule({ match: { tool: "shell", "args.command": ["**git push**"] }, action: "ask" })];
    const r = matchRules(rules, "shell", { command: "git push origin" });
    expect(r.decision).toBe("ask");
  });
});
