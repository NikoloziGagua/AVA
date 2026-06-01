import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type SelfKnowledge = {
  repoRoot: string; testCmd: string; buildCmd: string; devCmd: string; body: string;
};

export function loadSelfKnowledge(opts: { repoRoot: string }): SelfKnowledge {
  const selfMd = fileURLToPath(new URL("./SELF.md", import.meta.url));
  return {
    repoRoot: opts.repoRoot,
    testCmd: "npm test",
    buildCmd: "npm -w web run build && npm -w server run build",
    devCmd: "npm -w server run dev",
    body: readFileSync(selfMd, "utf8"),
  };
}
