import { revertTo } from "./swap.js";
import { decideRollback } from "./watchdog.js";

// Spawned detached at swap time:
//   tsx watchdog-main.ts <repoRoot> <knownGood> <healthUrl> <timeoutMs> <swappedSha>
// Polls the new process's health; if it never comes up, reverts the repo to
// last-known-good (the file change makes the dev watcher reload back to safety).
// `swappedSha` (the commit the swap moved HEAD to) guards the rollback: if newer
// work was committed on top in the meantime, revertTo SKIPS rather than clobbers.
async function main(): Promise<void> {
  const [, , repoRoot, knownGood, healthUrl, timeoutMsRaw, swappedSha] = process.argv;
  if (!repoRoot || !knownGood || !healthUrl) { process.exit(1); return; }
  const timeoutMs = Number(timeoutMsRaw ?? "45000");
  await decideRollback({
    timeoutMs, intervalMs: 1000,
    checkHealth: async () => { try { const r = await fetch(healthUrl); return r.ok; } catch { return false; } },
    rollback: async () => { revertTo(repoRoot, knownGood, swappedSha || undefined); },
  });
  process.exit(0);
}
void main();
