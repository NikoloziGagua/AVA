import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "./db.js";
import { createRule, getRule, listRules, updateRule, deleteRule } from "./rules.js";

let db: Db;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ava-rules-"));
  db = openDb(join(dir, "x.db"));
});

describe("rules repo", () => {
  it("createRule returns a rule with defaults", () => {
    const rule = createRule(db, { source: "always ask before deleting files" });
    expect(rule.id).toHaveLength(12);
    expect(rule.source).toBe("always ask before deleting files");
    expect(rule.parsed).toBeNull();
    expect(rule.enabled).toBe(1);
    expect(rule.status).toBe("pending");
    expect(rule.created_at).toBeGreaterThan(0);
    expect(rule.updated_at).toBe(rule.created_at);
  });

  it("createRule accepts optional parsed and status", () => {
    const rule = createRule(db, {
      source: "never run git push --force",
      parsed: '{"action":"deny","tool":"git"}',
      status: "active",
    });
    expect(rule.parsed).toBe('{"action":"deny","tool":"git"}');
    expect(rule.status).toBe("active");
  });

  it("getRule returns the row or null", () => {
    const rule = createRule(db, { source: "confirm before npm publish" });
    const found = getRule(db, rule.id);
    expect(found).not.toBeNull();
    expect(found?.source).toBe("confirm before npm publish");
    expect(getRule(db, "does-not-exist")).toBeNull();
  });

  it("listRules returns rules ordered by created_at DESC", () => {
    const r1 = createRule(db, { source: "rule one" });
    // Force a different timestamp for r2 by inserting with a later created_at directly
    const r2 = createRule(db, { source: "rule two" });
    // Patch r2 to have a strictly later created_at so ordering is deterministic
    db.prepare("UPDATE rules SET created_at = ?, updated_at = ? WHERE id = ?").run(
      r1.created_at + 1,
      r1.updated_at + 1,
      r2.id,
    );
    const all = listRules(db);
    expect(all.length).toBe(2);
    // r2 was created after r1, so it comes first
    expect(all[0]?.id).toBe(r2.id);
    expect(all[1]?.id).toBe(r1.id);
  });

  it("updateRule patches fields and bumps updated_at", () => {
    const rule = createRule(db, { source: "ask before writing to prod" });
    const before = rule.updated_at;
    // Ensure at least 1 ms passes
    const start = Date.now();
    while (Date.now() <= start) { /* spin */ }
    updateRule(db, rule.id, { enabled: false, status: "active", parsed: '{"x":1}' });
    const updated = getRule(db, rule.id);
    expect(updated?.enabled).toBe(0);
    expect(updated?.status).toBe("active");
    expect(updated?.parsed).toBe('{"x":1}');
    expect(updated?.updated_at).toBeGreaterThan(before);
  });

  it("deleteRule removes the row", () => {
    const rule = createRule(db, { source: "never overwrite backups" });
    deleteRule(db, rule.id);
    expect(getRule(db, rule.id)).toBeNull();
    expect(listRules(db).length).toBe(0);
  });
});
