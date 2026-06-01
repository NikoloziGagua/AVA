export async function decideRollback(o: {
  checkHealth: () => Promise<boolean>; timeoutMs: number; intervalMs: number;
  rollback: () => Promise<void>;
}): Promise<void> {
  const deadline = Date.now() + o.timeoutMs;
  while (Date.now() < deadline) {
    if (await o.checkHealth()) return;
    await new Promise((r) => setTimeout(r, o.intervalMs));
  }
  await o.rollback();
}
