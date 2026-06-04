import type { ClaudeCode } from "../tools/claude-code.js";

// Ava chooses its OWN next self-improvement by consulting its persistent Claude
// chat. Run this in the STABLE repo dir (not a worktree) so the session resumes
// correctly and Claude remembers prior suggestions (avoids repeats). Best-effort:
// returns a one-line goal, or null when there's no safe/useful idea.
export async function suggestImprovement(
  worker: Pick<ClaudeCode, "run">,
  o: { cwd: string; session: { id: string; resume: boolean }; runId?: string },
): Promise<string | null> {
  const prompt =
    "You are Ava, an AI agent, choosing your OWN next self-improvement to THIS repository. " +
    "Read the codebase as needed. Propose ONE concrete, genuinely useful, LOW-RISK improvement " +
    "(a small feature, fix, test, or polish — front-end or back-end) that can be implemented as a " +
    "minimal change while keeping ALL existing tests passing.\n" +
    "HARD CONSTRAINTS: do NOT propose changes to safety, verification, approval, sandboxing, " +
    "secret-scrubbing, or self-improvement-loop code; do NOT repeat a goal you already suggested " +
    "in this conversation; keep it small enough to verify.\n" +
    "Reply with ONLY one line beginning 'GOAL:' followed by the goal. If you have no safe, useful, " +
    "new idea, reply exactly 'GOAL: none'.";
  const r = await worker.run({
    prompt, cwd: o.cwd, runId: o.runId ?? `suggest-${Date.now()}`, session: o.session,
  });
  if (!r.ok) return null;
  const line = r.output
    .split("\n").map((l) => l.trim())
    .find((l) => l.toUpperCase().startsWith("GOAL:"));
  if (!line) return null;
  const goal = line.slice(line.indexOf(":") + 1).trim();
  if (!goal || goal.toLowerCase() === "none") return null;
  return goal;
}
