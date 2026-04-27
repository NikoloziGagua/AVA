import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export class PidfileRegistry {
  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  add(runId: string, pid: number): void {
    const dir = join(this.baseDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, String(pid)), "");
  }

  list(runId: string): number[] {
    const dir = join(this.baseDir, runId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => Number(name))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  clear(runId: string): void {
    const dir = join(this.baseDir, runId);
    rmSync(dir, { recursive: true, force: true });
  }

  remove(runId: string, pid: number): void {
    const file = join(this.baseDir, runId, String(pid));
    rmSync(file, { force: true });
  }

  listAll(): Array<{ runId: string; pid: number }> {
    if (!existsSync(this.baseDir)) return [];
    const out: Array<{ runId: string; pid: number }> = [];
    for (const runId of readdirSync(this.baseDir)) {
      for (const pid of this.list(runId)) out.push({ runId, pid });
    }
    return out;
  }
}
