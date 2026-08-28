import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { scrubSecrets } from "../security/scrub.js";
import type { CaptureMemoryResult } from "./types.js";
import type { MemoryIndexService } from "./store.js";

export type CommittedImprovement = {
  sha: string;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  committedAt: number;
  files: string[];
  featureDocumentation: string | null;
};

export interface ImprovementCommitSource {
  existsOnCurrentBranch(sha: string): boolean;
  listRecent(limit: number): string[];
  read(sha: string): CommittedImprovement;
}

const PRODUCT_ROOTS = ["server/src/", "server/scripts/", "web/src/", "web/scripts/", "scripts/", ".codex/"] as const;
const PRODUCT_FILES = new Set(["package.json", "package-lock.json", "server/package.json", "web/package.json"]);
const TEST_PATH = /(?:^|\/)(?:__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;

function runGit(repoRoot: string, args: string[], maxBuffer = 8 * 1024 * 1024): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function cleanInline(value: string, max: number): string {
  return scrubSecrets(value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanBlock(value: string, max: number): string {
  return scrubSecrets(value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function unique(values: readonly string[], limit = 20): string[] {
  return [...new Set(values.map((value) => cleanInline(value, 260)).filter(Boolean))].slice(0, limit);
}

function productFiles(files: readonly string[]): string[] {
  return unique(files.map((file) => file.replace(/\\/g, "/")), 160)
    .filter((file) => PRODUCT_FILES.has(file) || PRODUCT_ROOTS.some((root) => file.startsWith(root)))
    .filter((file) => !TEST_PATH.test(file));
}

function actorFor(commit: CommittedImprovement): "ava" | "codex" | "claude" | "niko" | "other" {
  const author = `${commit.authorName} ${commit.authorEmail}`.toLocaleLowerCase();
  if (/codex|openai/.test(author)) return "codex";
  if (/claude|anthropic/.test(author)) return "claude";
  if (/\bava\b/.test(author)) return "ava";
  if (/niko|nikug/.test(author)) return "niko";
  return "other";
}

function capabilitiesFor(commit: CommittedImprovement): string[] {
  const haystack = `${commit.subject}\n${commit.files.join("\n")}`.toLocaleLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/ufo/, "Microsoft UFO"],
    [/memory-index|semantic.memory/, "Semantic memory"],
    [/voice|realtime|hume/, "Voice"],
    [/observability|mission-control|receipt/, "Mission Control"],
    [/watch/, "Watchers"],
    [/self\/|self-improvement|self improvement/, "Self-improvement"],
    [/instagram/, "Instagram"],
    [/whatsapp/, "WhatsApp"],
    [/visual/, "Visual explanations"],
    [/notes?\//, "Notes"],
    [/strategy/, "Strategy Room"],
    [/explorer|capabilit/, "Explorer"],
    [/browser|chrome/, "Browser automation"],
  ];
  const selected = matches.filter(([pattern]) => pattern.test(haystack)).map(([, label]) => label);
  return unique(selected.length ? selected : ["AVA core"], 12);
}

function titleFor(subject: string): string {
  const withoutPrefix = subject.replace(/^(?:feat|fix|perf|refactor|build|chore)(?:\([^)]+\))?!?:\s*/i, "")
    .replace(/^self:\s*/i, "");
  const clean = cleanInline(withoutPrefix || subject, 150);
  return clean ? clean.charAt(0).toLocaleUpperCase() + clean.slice(1) : "AVA product improvement";
}

function firstUsefulParagraph(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const statusIndex = lines.findIndex((line) => /^##\s+Status\s*$/i.test(line.trim()));
  const start = statusIndex >= 0 ? statusIndex + 1 : 0;
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join(" "));
    current = [];
  };
  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^#{1,6}\s/.test(line) || /^[-*]\s/.test(line) || /^```/.test(line)) { flush(); continue; }
    current.push(line);
  }
  flush();
  const paragraph = paragraphs.map((value) => cleanInline(value, 1_800)).find((value) => value.length >= 45);
  return paragraph || null;
}

export class GitImprovementCommitSource implements ImprovementCommitSource {
  private readonly cache = new Map<string, CommittedImprovement>();
  private reachable = new Set<string>();
  private cachedHead: string | null = null;
  private headCheckedAt = 0;

  constructor(private readonly repoRoot: string) {}

  private refreshReachability(): void {
    const now = Date.now();
    if (this.cachedHead && now - this.headCheckedAt < 1_000) return;
    const head = runGit(this.repoRoot, ["rev-parse", "HEAD"]).trim().toLocaleLowerCase();
    this.headCheckedAt = now;
    if (head === this.cachedHead && this.reachable.size) return;
    this.cachedHead = head;
    this.reachable = new Set(runGit(this.repoRoot, ["rev-list", "--max-count=2000", "HEAD"])
      .split(/\r?\n/).map((line) => line.trim().toLocaleLowerCase()).filter(Boolean));
  }

  existsOnCurrentBranch(sha: string): boolean {
    if (!/^[a-f0-9]{40}$/i.test(sha)) return false;
    try {
      this.refreshReachability();
      return this.reachable.has(sha.toLocaleLowerCase());
    } catch {
      return false;
    }
  }

  listRecent(limit: number): string[] {
    const bounded = Math.max(1, Math.min(2_000, Math.floor(limit)));
    const raw = runGit(this.repoRoot, [
      "log",
      `--max-count=${bounded}`,
      "--format=__AVA_COMMIT__%H%x00%ct%x00%an%x00%ae%x00%s%x00%b%x00__AVA_FILES__",
      "--name-only",
    ], 32 * 1024 * 1024);
    const commits: string[] = [];
    for (const chunk of raw.split("__AVA_COMMIT__").slice(1)) {
      const marker = chunk.indexOf("\0__AVA_FILES__");
      if (marker < 0) continue;
      const metadata = chunk.slice(0, marker).split("\0");
      const sha = (metadata[0] ?? "").trim().toLocaleLowerCase();
      if (!/^[a-f0-9]{40}$/.test(sha)) continue;
      const files = unique(chunk.slice(marker + "\0__AVA_FILES__".length)
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean), 200);
      this.cache.set(sha, {
        sha,
        committedAt: Number(metadata[1]) * 1_000,
        authorName: cleanInline(metadata[2] ?? "", 120),
        authorEmail: cleanInline(metadata[3] ?? "", 180),
        subject: cleanInline(metadata[4] ?? "", 240),
        body: cleanBlock(metadata.slice(5).join("\0"), 4_000),
        files,
        // Full-history boot reconciliation is one Git process. A direct Self
        // shipment read may still attach its feature document below.
        featureDocumentation: null,
      });
      commits.push(sha);
    }
    if (commits.length) {
      this.cachedHead = commits[0]!;
      this.headCheckedAt = Date.now();
      this.reachable = new Set(commits);
    }
    return commits;
  }

  read(sha: string): CommittedImprovement {
    const normalizedSha = sha.toLocaleLowerCase();
    if (!this.existsOnCurrentBranch(normalizedSha)) throw new Error("commit is not reachable from current AVA HEAD");
    const cached = this.cache.get(normalizedSha);
    if (cached) return cached;
    const metadata = runGit(this.repoRoot, ["show", "-s", "--format=%H%x00%ct%x00%an%x00%ae%x00%s%x00%b", sha])
      .replace(/\r?\n$/, "").split("\0");
    if (metadata.length < 6 || metadata[0]?.toLocaleLowerCase() !== sha.toLocaleLowerCase()) {
      throw new Error("commit metadata is malformed");
    }
    const files = unique(runGit(this.repoRoot, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha])
      .split(/\r?\n/), 200);
    const featurePath = files.find((file) => /^docs\/features\/.+\.md$/i.test(file));
    let featureDocumentation: string | null = null;
    if (featurePath) {
      try { featureDocumentation = runGit(this.repoRoot, ["show", `${sha}:${featurePath}`], 2 * 1024 * 1024); }
      catch { featureDocumentation = null; }
    }
    const commit = {
      sha: sha.toLocaleLowerCase(),
      committedAt: Number(metadata[1]) * 1_000,
      authorName: cleanInline(metadata[2] ?? "", 120),
      authorEmail: cleanInline(metadata[3] ?? "", 180),
      subject: cleanInline(metadata[4] ?? "", 240),
      body: cleanBlock(metadata.slice(5).join("\0"), 4_000),
      files,
      featureDocumentation,
    };
    this.cache.set(commit.sha, commit);
    return commit;
  }
}

export class ImprovementIndexCoordinator {
  constructor(
    private readonly memory: MemoryIndexService,
    private readonly commits: ImprovementCommitSource,
  ) {}

  async indexCommit(
    sha: string,
    override: Partial<Pick<CommittedImprovement, "subject" | "body">> & {
      actor?: "ava" | "codex" | "claude" | "niko" | "other";
      sourceKind?: "git_commit" | "self_swap";
    } = {},
  ): Promise<CaptureMemoryResult | null> {
    const commit = this.commits.read(sha);
    const products = productFiles(commit.files);
    if (!products.length) return null;
    const capabilities = capabilitiesFor(commit);
    const documentation = commit.featureDocumentation ? firstUsefulParagraph(commit.featureDocumentation) : null;
    const body = cleanBlock(override.body ?? commit.body, 2_000);
    const summary = documentation
      ?? (body ? body.split(/\n\s*\n/)[0] : null)
      ?? `AVA committed ${titleFor(override.subject ?? commit.subject)}. The source commit changes ${products.length} product file${products.length === 1 ? "" : "s"} across ${capabilities.join(", ")}.`;
    return this.memory.captureImprovement({
      commitSha: commit.sha,
      sourceKind: override.sourceKind ?? "git_commit",
      actor: override.actor ?? actorFor(commit),
      title: titleFor(override.subject ?? commit.subject),
      summary,
      capabilities,
      changedFiles: products,
      verification: [
        `Git commit ${commit.sha.slice(0, 12)} is reachable from AVA's current branch.`,
        `${products.length} committed product file${products.length === 1 ? "" : "s"} provide the change boundary.`,
        ...(commit.featureDocumentation ? ["Committed feature documentation is attached to the same source commit."] : []),
      ],
      tags: [
        ...capabilities.map((value) => value.toLocaleLowerCase().replace(/\s+/g, "-")),
        basename(products[0] ?? "ava"),
      ],
      shippedAt: commit.committedAt,
      deferEmbedding: true,
    });
  }

  async reconcileRecent(limit = 1_000): Promise<{ indexed: number; reused: number; skipped: number; failed: number }> {
    const result = { indexed: 0, reused: 0, skipped: 0, failed: 0 };
    for (const sha of this.commits.listRecent(limit).reverse()) {
      try {
        const captured = await this.indexCommit(sha);
        if (!captured) result.skipped += 1;
        else if (captured.created) result.indexed += 1;
        else result.reused += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}
