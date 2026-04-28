import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent, type AgentEvent } from "./agent.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import { openInMemoryDb, type Db } from "../state/db.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";

function seedAllowAllRule(db: Db): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO rules (id, source, parsed, enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("allow-all", "allow all", JSON.stringify({ match: {}, action: "allow" }), 1, "active", now, now);
}

describe("memory firewall (end-to-end)", () => {
  it("scrubs OPENAI_API_KEY=sk-... before persisting through memory_remember", async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "ava-fw-"));
    bootstrapMemoryDir({ dir: memoryDir });

    const provider = new MockLLMProvider({
      scripts: [
        [
          { kind: "tool_call",
            call: { id: "c1", name: "memory_remember",
              args: {
                text: "leaked: OPENAI_API_KEY=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                category: "setup",
                today: "2026-04-28",
              } } },
          { kind: "done", stop_reason: "tool_use" },
        ],
        [
          { kind: "delta", text: "Done." },
          { kind: "done", stop_reason: "end_turn" },
        ],
      ],
    });

    const db = openInMemoryDb();
    seedAllowAllRule(db);
    const events: AgentEvent[] = [];

    await runAgent({
      prompt: "remember this", abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e), runId: "r1", sessionId: "s1", db,
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir, provider, tools: buildMemoryTools({ memoryDir }),
      } as never,
    } as never);

    const persisted = readFileSync(join(memoryDir, "observations.md"), "utf8");
    expect(persisted).not.toContain("sk-AAAA");
    expect(persisted).toContain("sk-***");
  });
});
