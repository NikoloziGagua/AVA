import { nanoid } from "nanoid";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { CodexConsultant, CodexConsultResult } from "./codex-consultant.js";
import { StrategyRoomStore, type DecisionResult } from "./store.js";
import type { StrategyMessage, StrategyPhase, StrategyRoom, StrategyRoomDetail } from "./types.js";

type ActiveRoom = { generation: number; controller: AbortController };

export type StrategyCoordinatorDeps = {
  store: StrategyRoomStore;
  provider: LLMProvider | null;
  codex: CodexConsultant;
  repoRoot: string;
  log?: {
    info: (obj: unknown, message: string) => void;
    warn: (obj: unknown, message: string) => void;
  };
};

const AVA_SYSTEM = `You are AVA, the top-level facilitator in a persistent Strategy Room with Niko and Codex.
This is discussion and planning only. Never execute tools, modify files, or claim implementation started.
Speak only as AVA. Attribute Codex and Niko faithfully; never invent agreement or quote them inaccurately.
Expose concise conclusions, evidence, assumptions and tradeoffs, but never hidden chain-of-thought.
Prefer concrete recommendations over generic brainstorming. Niko has final authority.`;

function publicTranscript(detail: StrategyRoomDetail, maxChars = 28_000): string {
  const label = { niko: "Niko", ava: "AVA", codex: "Codex", system: "System" } as const;
  const lines = detail.messages
    .filter((message) => message.kind !== "status")
    .map((message) => `${label[message.author]} [${message.kind}]:\n${message.content}`);
  const full = lines.join("\n\n---\n\n");
  return full.length <= maxChars ? full : `[Earlier context trimmed]\n\n${full.slice(-maxChars)}`;
}

export async function askAva(
  provider: LLMProvider,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  let output = "";
  for await (const event of provider.stream({
    model: provider.defaultOrchestratorModel,
    system: AVA_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    tools: [],
    abort: signal,
    reasoningEffort: "medium",
  })) {
    if (signal.aborted) throw new Error("aborted");
    if (event.kind === "delta") output += event.text;
    if (event.kind === "done" && event.stop_reason === "error") {
      throw new Error(event.error ?? "AVA response failed");
    }
  }
  const final = output.trim();
  if (!final) throw new Error("AVA returned no public response");
  return final.slice(0, 32_000);
}

function codexPrompt(room: StrategyRoom, transcript: string, stage: "review" | "final"): string {
  const instruction = stage === "review"
    ? "Give an independent critical response: strongest ideas, weaknesses, missing evidence, tradeoffs, and your recommendation."
    : "Respond to AVA's cross-review, resolve the important disagreements, and state the conclusion you would recommend to Niko.";
  return `You are Codex participating in AVA Strategy Room ${room.id}.

This is a read-only design discussion. Do not modify files, claim an area, append to coordination files, begin implementation, or expose hidden chain-of-thought. You may inspect the AVA repository read-only when it materially grounds your answer.
Speak only as Codex and return only the concise public message that should appear in the room. Do not impersonate AVA or Niko.

Topic: ${room.topic}

Conversation so far:
${transcript}

Your task:
${instruction}`;
}

function avaPrompt(room: StrategyRoom, transcript: string, stage: "position" | "cross_review" | "synthesis"): string {
  if (stage === "position") {
    return `Strategy Room topic: ${room.topic}

Conversation:
${transcript}

Frame the problem and give AVA's initial position. Identify the desired outcome, constraints, assumptions, highest-value options and the questions the group must settle. Do not declare consensus yet.`;
  }
  if (stage === "cross_review") {
    return `Strategy Room topic: ${room.topic}

Conversation:
${transcript}

Codex has responded. Cross-review it as AVA: state what is strong, what you disagree with or would modify, what evidence is still missing, and the direction you now recommend. Leave a clear issue for Codex's final response.`;
  }
  return `Strategy Room topic: ${room.topic}

Complete attributed conversation:
${transcript}

Produce the proposed conclusion as a living brief in Markdown using exactly these sections:
# Objective
# Confirmed facts
# Options and tradeoffs
# Recommended decision
# Open questions for Niko
# Proposed next steps

Be specific. Preserve real disagreements instead of manufacturing consensus. End with: "Awaiting Niko's approval — no implementation has started."`;
}

export class StrategyRoomCoordinator {
  private readonly active = new Map<string, ActiveRoom>();
  private generation = 0;

  constructor(readonly deps: StrategyCoordinatorDeps) {}

  create(topic: string): StrategyRoomDetail {
    const detail = this.deps.store.createRoom(topic);
    this.start(detail.room.id);
    return this.deps.store.getDetail(detail.room.id)!;
  }

  addNikoMessage(roomId: string, content: string): StrategyRoomDetail | null {
    const current = this.deps.store.getRoom(roomId);
    if (!current) return null;
    this.deps.store.appendMessage(roomId, { author: "niko", kind: "message", content });
    this.deps.store.reopenForInput(roomId);
    this.start(roomId);
    return this.deps.store.getDetail(roomId);
  }

  resume(roomId: string, expectedVersion: number): DecisionResult {
    const current = this.deps.store.getRoom(roomId);
    if (!current) return { ok: false, reason: "not_found", room: null };
    if (current.version !== expectedVersion) return { ok: false, reason: "stale_version", room: current };
    if (current.status === "discussing") return { ok: false, reason: "invalid_status", room: current };
    const room = this.deps.store.reopenForInput(roomId);
    this.start(roomId);
    return { ok: true, room };
  }

  approve(roomId: string, expectedVersion: number): DecisionResult {
    return this.deps.store.approve(roomId, expectedVersion);
  }

  stop(roomId: string, expectedVersion: number): DecisionResult {
    const result = this.deps.store.pause(roomId, expectedVersion);
    if (result.ok) this.cancelActive(roomId);
    return result;
  }

  isActive(roomId: string): boolean {
    return this.active.has(roomId);
  }

  shutdown(): void {
    for (const active of this.active.values()) active.controller.abort();
    this.active.clear();
  }

  private start(roomId: string): void {
    this.cancelActive(roomId);
    const controller = new AbortController();
    const generation = ++this.generation;
    this.active.set(roomId, { generation, controller });
    void this.run(roomId, generation, controller.signal)
      .catch((error) => this.fail(roomId, generation, error))
      .finally(() => {
        if (this.active.get(roomId)?.generation === generation) this.active.delete(roomId);
      });
  }

  private cancelActive(roomId: string): void {
    const active = this.active.get(roomId);
    if (!active) return;
    this.active.delete(roomId);
    active.controller.abort();
  }

  private current(roomId: string, generation: number): boolean {
    const active = this.active.get(roomId);
    return active?.generation === generation && !active.controller.signal.aborted;
  }

  private setPhase(roomId: string, generation: number, phase: StrategyPhase, actor: "ava" | "codex"): StrategyRoom {
    if (!this.current(roomId, generation)) throw new Error("aborted");
    return this.deps.store.updateRoom(roomId, {
      status: "discussing",
      phase,
      activeActor: actor,
      error: null,
    });
  }

  private append(roomId: string, generation: number, message: Omit<StrategyMessage, "id" | "roomId" | "sequence" | "createdAt" | "correlationId">): void {
    if (!this.current(roomId, generation)) throw new Error("aborted");
    this.deps.store.appendMessage(roomId, {
      author: message.author,
      kind: message.kind,
      content: message.content,
      correlationId: `strategy_${roomId}_${generation}`,
    });
  }

  private async run(roomId: string, generation: number, signal: AbortSignal): Promise<void> {
    const provider = this.deps.provider;
    if (!provider) throw new Error("AVA's discussion model is not configured");
    let room = this.deps.store.getRoom(roomId);
    if (!room) return;

    this.setPhase(roomId, generation, "framing", "ava");
    let detail = this.deps.store.getDetail(roomId)!;
    const avaPosition = await askAva(provider, avaPrompt(room, publicTranscript(detail), "position"), signal);
    this.append(roomId, generation, { author: "ava", kind: "position", content: avaPosition });

    room = this.setPhase(roomId, generation, "codex_review", "codex");
    detail = this.deps.store.getDetail(roomId)!;
    const firstCodex = await this.askCodex(room, codexPrompt(room, publicTranscript(detail), "review"), signal);
    if (!firstCodex.ok) throw new Error(`Codex unavailable: ${firstCodex.error}`);
    if (!this.current(roomId, generation)) throw new Error("aborted");
    this.deps.store.updateRoom(roomId, { codexThreadId: firstCodex.threadId });
    this.deps.store.recordEvent(roomId, "strategy.codex.turn.completed", {
      threadId: firstCodex.threadId,
      usage: firstCodex.usage,
      stage: "review",
    });
    this.append(roomId, generation, { author: "codex", kind: "review", content: firstCodex.text });

    room = this.setPhase(roomId, generation, "cross_review", "ava");
    detail = this.deps.store.getDetail(roomId)!;
    const avaReview = await askAva(provider, avaPrompt(room, publicTranscript(detail), "cross_review"), signal);
    this.append(roomId, generation, { author: "ava", kind: "review", content: avaReview });

    room = this.setPhase(roomId, generation, "codex_final", "codex");
    detail = this.deps.store.getDetail(roomId)!;
    const finalCodex = await this.askCodex(room, codexPrompt(room, publicTranscript(detail), "final"), signal);
    if (!finalCodex.ok) throw new Error(`Codex unavailable: ${finalCodex.error}`);
    this.deps.store.recordEvent(roomId, "strategy.codex.turn.completed", {
      threadId: finalCodex.threadId,
      usage: finalCodex.usage,
      stage: "final",
    });
    this.append(roomId, generation, { author: "codex", kind: "review", content: finalCodex.text });

    room = this.setPhase(roomId, generation, "synthesis", "ava");
    detail = this.deps.store.getDetail(roomId)!;
    const synthesis = await askAva(provider, avaPrompt(room, publicTranscript(detail), "synthesis"), signal);
    this.append(roomId, generation, { author: "ava", kind: "synthesis", content: synthesis });
    if (!this.current(roomId, generation)) throw new Error("aborted");
    this.deps.store.updateRoom(roomId, {
      status: "awaiting_niko",
      phase: "waiting_for_niko",
      activeActor: null,
      livingBrief: synthesis,
      conclusion: synthesis,
      error: null,
    });
    this.deps.store.recordEvent(roomId, "strategy.conclusion.proposed", { round: room.round });
    this.deps.log?.info({ roomId, round: room.round }, "strategy room reached Niko review");
  }

  private askCodex(room: StrategyRoom, prompt: string, signal: AbortSignal): Promise<CodexConsultResult> {
    return this.deps.codex.consult({
      prompt,
      cwd: this.deps.repoRoot,
      runId: `strategy-${room.id}-${nanoid(8)}`,
      threadId: room.codexThreadId,
      timeoutMs: 3 * 60_000,
      signal,
    });
  }

  private fail(roomId: string, generation: number, error: unknown): void {
    if (!this.current(roomId, generation)) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message === "aborted") return;
    this.deps.store.appendMessage(roomId, {
      author: "system",
      kind: "error",
      content: `Discussion stopped because ${message}`,
    });
    this.deps.store.updateRoom(roomId, {
      status: "failed",
      phase: "failed",
      activeActor: null,
      error: message,
    });
    this.deps.log?.warn({ roomId, error: message }, "strategy room failed");
  }
}
