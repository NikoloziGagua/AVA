export type RunResult = { code: number; output: string };
export type RunFn = (cmd: string, cwd: string, signal?: AbortSignal) => Promise<RunResult>;
export type BootSmokeFn = (cwd: string) => Promise<{ ok: boolean; log: string }>;

// Order matters: tests first (cheapest signal), then build web + server so the
// boot smoke-test below runs the freshly-built `dist/`.
/**
 * `test:explorer-contract` is in here deliberately.
 *
 * It bridges the two Explorer registries AND runs the reality check that
 * resolves every declared symbol, tool and route against the real source tree.
 * Without it in this list, AVA can rewrite her own source, break her own
 * capability map, and report every gate green — which is exactly how eleven
 * dead symbols and six dead routes reached the interface as authoritative fact.
 */
const CHECKS = [
  "npm test",
  "npm -w web run build",
  "npm -w server run build",
  "npm run test:explorer-contract",
];

export async function verify(o: {
  cwd: string; run: RunFn; bootSmoke: BootSmokeFn; signal?: AbortSignal;
}): Promise<{ ok: boolean; log: string }> {
  for (const cmd of CHECKS) {
    if (o.signal?.aborted) return { ok: false, log: "cancelled" };
    const r = await o.run(cmd, o.cwd, o.signal);
    if (r.code !== 0) return { ok: false, log: `FAILED: ${cmd}\n${r.output}` };
  }
  if (o.signal?.aborted) return { ok: false, log: "cancelled" };
  const boot = await o.bootSmoke(o.cwd);
  if (!boot.ok) return { ok: false, log: `FAILED: boot smoke-test\n${boot.log}` };
  return { ok: true, log: "all checks + boot smoke passed" };
}
