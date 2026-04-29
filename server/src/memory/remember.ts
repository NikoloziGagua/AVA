import { memoryPaths } from "./paths.js";
import { readFile, writeFile } from "./store.js";
import { serializeObservation, type Confidence } from "./observations.js";
import { promoteOnRepeat, type PromoteResult } from "./promote.js";

export type RememberOpts = {
  memoryDir: string;
  category: string;
  confidence: Confidence;
  text: string;
  today: string;
};

export function rememberObservation(opts: RememberOpts): PromoteResult {
  const p = memoryPaths(opts.memoryDir);
  const newLine = serializeObservation({
    date: opts.today,
    confidence: opts.confidence,
    category: opts.category,
    text: opts.text,
    superseded: null,
  });
  const existing = readFile(p.observations);
  const r = promoteOnRepeat(existing, newLine, opts.today);
  writeFile(p.observations, r.content);
  return r;
}
