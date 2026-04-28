import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLogger } from "./logger.js";

describe("buildLogger", () => {
  it("scrubs Anthropic keys from message strings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-log-"));
    const log = await buildLogger({ level: "info", dir });
    log.info("user said sk-ant-abc1234567 hello");
    await log.flush();
    const file = readdirSync(dir).find((f) => f.endsWith(".log"))!;
    const lines = readFileSync(join(dir, file), "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1)!);
    expect(last.msg).toBe("user said sk-ant-*** hello");
  });

  it("scrubs values inside log bindings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-log-"));
    const log = await buildLogger({ level: "info", dir });
    log.info({ apiKey: "sk-ant-secret9999999" }, "sending");
    await log.flush();
    const file = readdirSync(dir).find((f) => f.endsWith(".log"))!;
    const last = JSON.parse(readFileSync(join(dir, file), "utf8").trim().split("\n").at(-1)!);
    expect(last.apiKey).toBe("sk-ant-***");
  });

  it("does not scrub unrelated string fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-log-"));
    const log = await buildLogger({ level: "info", dir });
    log.info({ path: "C:/ai/x.txt" }, "ok");
    await log.flush();
    const file = readdirSync(dir).find((f) => f.endsWith(".log"))!;
    const last = JSON.parse(readFileSync(join(dir, file), "utf8").trim().split("\n").at(-1)!);
    expect(last.path).toBe("C:/ai/x.txt");
  });

  it("emits to a dated filename under the configured dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-log-"));
    const log = await buildLogger({ level: "info", dir });
    log.info("hello");
    await log.flush();
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    // pino-roll filenames follow `<base>.<date>.<n>.<ext>`, e.g.
    // `server.2026-04-28.1.log`. Daily rotation = a new file when the date rolls.
    expect(files[0]).toMatch(/^server\.\d{4}-\d{2}-\d{2}\.\d+\.log$/);
  });
});
