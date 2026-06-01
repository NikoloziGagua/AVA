export type RunResult = { code: number; output: string };
export type RunFn = (cmd: string, cwd: string) => Promise<RunResult>;
export type BootSmokeFn = (cwd: string) => Promise<{ ok: boolean; log: string }>;

// Order matters: tests first (cheapest signal), then build web + server so the
// boot smoke-test below runs the freshly-built `dist/`.
const CHECKS = ["npm test", "npm -w web run build", "npm -w server run build"];

export async function verify(o: { cwd: string; run: RunFn; bootSmoke: BootSmokeFn }): Promise<{ ok: boolean; log: string }> {
  for (const cmd of CHECKS) {
    const r = await o.run(cmd, o.cwd);
    if (r.code !== 0) return { ok: false, log: `FAILED: ${cmd}\n${r.output}` };
  }
  const boot = await o.bootSmoke(o.cwd);
  if (!boot.ok) return { ok: false, log: `FAILED: boot smoke-test\n${boot.log}` };
  return { ok: true, log: "all checks + boot smoke passed" };
}
