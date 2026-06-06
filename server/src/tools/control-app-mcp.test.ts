import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { buildControlAppTool, controlScriptPath } from "./control-app-mcp.js";

describe("control_app tool", () => {
  it("exposes the control_app tool name + required script input", () => {
    const t = buildControlAppTool({ signal: new AbortController().signal });
    expect(t.tool.name).toBe("control_app");
    const schema = t.tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.script).toBeDefined();
    expect(schema.required).toContain("script");
  });

  it("rejects an empty script without spawning PowerShell", async () => {
    const t = buildControlAppTool({ signal: new AbortController().signal });
    const r = await t.run({ script: "" }, { runId: "r1" });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("missing script");

    const missing = await t.run({}, { runId: "r1" });
    expect(missing.ok).toBe(false);
    expect(missing.text).toBe("missing script");
  });

  it("builds a .ps1 path under the home profile (inside fsRoots), not os.tmpdir", () => {
    const p = controlScriptPath("run-abc");
    const expectedDir = path.join(os.homedir(), "AppData", "Local", "Ava", "scripts");
    expect(path.dirname(p)).toBe(expectedDir);
    expect(p.endsWith(".ps1")).toBe(true);
    expect(path.basename(p).startsWith("ctl-run-abc-")).toBe(true);
    // Must be under the home profile, never the system temp dir (outside fsRoots).
    expect(p.startsWith(os.homedir())).toBe(true);
    expect(p.startsWith(os.tmpdir())).toBe(false);
  });

  it("gives each call a unique .ps1 path (no collision within a run)", () => {
    const a = controlScriptPath("run-x");
    const b = controlScriptPath("run-x");
    expect(a).not.toBe(b);
  });
});
