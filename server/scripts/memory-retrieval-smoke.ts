import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEmbedder, MemoryEmbedding } from "../src/memory-index/types.js";
import { retrieveAutomaticMemory } from "../src/memory-index/auto-retrieve.js";
import { MemoryIndexService } from "../src/memory-index/store.js";
import { openDb } from "../src/state/db.js";
import { appendMessage } from "../src/state/messages.js";
import { createSession } from "../src/state/sessions.js";

class SmokeEmbedder implements MemoryEmbedder {
  readonly provider = "manual-smoke";
  readonly model = "topic-v1";

  async embed(text: string): Promise<MemoryEmbedding> {
    const normalized = text.toLocaleLowerCase();
    const vector = normalized.includes("aurora") || normalized.includes("northern lights")
      ? [1, 0, 0]
      : normalized.includes("vault") || normalized.includes("quartz")
        ? [0, 1, 0]
        : [0, 0, 1];
    return { provider: this.provider, model: this.model, vector };
  }
}

async function capture(
  service: MemoryIndexService,
  db: ReturnType<typeof openDb>,
  input: {
    project?: string;
    privacyLevel?: "personal" | "project";
    title: string;
    user: string;
    assistant: string;
    summary: string;
  },
): Promise<void> {
  const session = createSession(db, { title: input.title });
  const user = appendMessage(db, { sessionId: session.id, role: "user", content: input.user });
  const assistant = appendMessage(db, { sessionId: session.id, role: "assistant", content: input.assistant });
  await service.capture({
    sessionId: session.id,
    fromMessageId: user.id,
    throughMessageId: assistant.id,
    kind: "idea",
    title: input.title,
    summary: input.summary,
    tags: input.title.toLocaleLowerCase().split(/\s+/).slice(0, 4),
    project: input.project,
    privacyLevel: input.privacyLevel,
  });
}

async function main(): Promise<void> {
  const smokeDir = mkdtempSync(join(tmpdir(), "ava-memory-retrieval-smoke-"));
  const dbPath = join(smokeDir, "ava-smoke.sqlite");
  const embedder = new SmokeEmbedder();
  let cleaned = false;
  try {
    let db = openDb(dbPath);
    let service = new MemoryIndexService(db, embedder);
    await capture(service, db, {
      title: "Aurora observation plan",
      user: "Develop an aurora observation plan for Iceland.",
      assistant: "The northern lights plan uses two flexible nights, cloud checks, and an inland fallback.",
      summary: "Use a flexible two-night window, cloud forecasts, and an inland fallback for the aurora.",
    });
    await capture(service, db, {
      title: "Quartz vault design",
      user: "Design the Quartz vault for Project Quartz.",
      assistant: "The Quartz vault uses a private encrypted backup and a project-only recovery key.",
      summary: "Project Quartz uses an encrypted vault with project-scoped recovery material.",
      project: "quartz",
      privacyLevel: "project",
    });

    db.close();
    assert.equal(existsSync(dbPath), true, "the durable index must exist before restart");

    // Reopen the SQLite source of truth to prove persistence independently of
    // process-local state, then use the same gate exercised by all channels.
    db = openDb(dbPath);
    service = new MemoryIndexService(db, embedder);
    const freshSession = createSession(db, { title: "Fresh chat" });
    const query = "How were we going to improve our chance of seeing the northern lights?";
    const chat = await retrieveAutomaticMemory(service, {
      query,
      channel: "chat",
      currentSessionId: freshSession.id,
    });
    const openAi = await retrieveAutomaticMemory(service, {
      query,
      channel: "openai_voice",
      currentSessionId: freshSession.id,
    });
    const hume = await retrieveAutomaticMemory(service, {
      query,
      channel: "hume_voice",
      currentSessionId: freshSession.id,
    });
    for (const decision of [chat, openAi, hume]) {
      assert.equal(decision.status, "used");
      assert.match(decision.prompt, /cloud checks/);
      assert.equal(decision.selected.length, 1);
    }
    assert.deepEqual(openAi.selected, chat.selected, "chat and OpenAI voice must select the same source");
    assert.deepEqual(hume.selected, chat.selected, "chat and Hume must select the same source");

    const irrelevant = await retrieveAutomaticMemory(service, {
      query: "Explain sourdough fermentation temperatures.",
      channel: "chat",
      currentSessionId: freshSession.id,
    });
    assert.equal(irrelevant.status, "no_match");
    assert.equal(irrelevant.prompt, "");

    const outsideProject = await retrieveAutomaticMemory(service, {
      query: "Recall the Quartz vault design.",
      channel: "chat",
      currentSessionId: freshSession.id,
    });
    const wrongProject = await retrieveAutomaticMemory(service, {
      query: "Recall the Quartz vault design.",
      channel: "chat",
      currentSessionId: freshSession.id,
      project: "other",
    });
    const insideProject = await retrieveAutomaticMemory(service, {
      query: "Recall the Quartz vault design.",
      channel: "chat",
      currentSessionId: freshSession.id,
      project: "quartz",
    });
    assert.equal(outsideProject.status, "no_match");
    assert.equal(wrongProject.status, "no_match");
    assert.equal(insideProject.status, "used");
    assert.equal(insideProject.selected[0]?.project, "quartz");

    db.close();
    rmSync(smokeDir, { recursive: true, force: true });
    cleaned = !existsSync(smokeDir);
    assert.equal(cleaned, true, "manual smoke data must be removed");
    process.stdout.write(`${JSON.stringify({
      ok: true,
      checks: [
        "fresh-chat retrieval",
        "OpenAI voice continuity",
        "Hume voice continuity",
        "semantic paraphrase",
        "irrelevant-memory suppression",
        "project/privacy isolation",
        "restart persistence",
        "temporary-data cleanup",
      ],
      selectedEntryId: chat.selected[0]?.entryId,
      semanticAvailable: chat.semanticAvailable,
      cleanup: cleaned,
    }, null, 2)}\n`);
  } finally {
    if (!cleaned && existsSync(smokeDir)) rmSync(smokeDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  process.stderr.write(`memory retrieval smoke failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
