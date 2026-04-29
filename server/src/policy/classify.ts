export type Tier = "read-only" | "low" | "medium" | "high" | "blocked";

export type Classification = { tier: Tier; reason: string };

const READ_ONLY_TOOLS = new Set([
  "fs_read", "fs_list", "fs_stat",
  "chrome_read_page", "chrome_screenshot", "chrome_tabs",
  "memory_read",
]);

const ENV_RE = /(^|[\\/])\.env(\.[\w-]+)?$|[\\/]\.env([\\/]|$)/i;
const HARD_BLOCKED_FLAGS = ["--dangerously-skip-permissions"];

const HIGH_RISK_SHELL = [
  /\brm\s+-rf?\b/i,
  /\bgit\s+push\b/i,
  /\bcurl\s+.*\|.*sh\b/i,
  /\bsudo\b/i,
];

const SUBMIT_LIKE = /button\[type=['"]?submit['"]?\]|#checkout|\.checkout|submit-?btn|place-?order|buy-?now|add-?payment/i;

function stringValues(obj: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(obj);
  return out;
}

export function classifyRisk(tool: string, args: unknown): Classification {
  const strs = stringValues(args);

  for (const s of strs) {
    if (ENV_RE.test(s)) return { tier: "blocked", reason: ".env path is hard-blocked" };
    for (const flag of HARD_BLOCKED_FLAGS) {
      if (s.includes(flag)) return { tier: "blocked", reason: `${flag} is hard-blocked` };
    }
  }

  if (READ_ONLY_TOOLS.has(tool)) return { tier: "read-only", reason: "read-only tool" };

  if (tool === "fs_delete") return { tier: "high", reason: "delete is always high-risk" };

  if (tool === "fs_write") return { tier: "low", reason: "filesystem write within allowlist" };

  if (tool === "chrome_navigate" || tool === "chrome_type" || tool === "chrome_press_key") {
    return { tier: "low", reason: "low-risk chrome action" };
  }

  if (tool === "chrome_click") {
    const sel = strs.join(" ");
    if (SUBMIT_LIKE.test(sel)) return { tier: "high", reason: "submit/checkout-like selector" };
    return { tier: "low", reason: "non-submit click" };
  }

  if (tool === "claude_code") return { tier: "medium", reason: "claude_code modifies code" };

  if (tool === "shell") {
    const cmd = strs.join(" ");
    for (const re of HIGH_RISK_SHELL) {
      if (re.test(cmd)) return { tier: "high", reason: `shell pattern: ${re.source}` };
    }
    return { tier: "medium", reason: "non-allowlisted shell" };
  }

  if (tool === "computer_use") return { tier: "medium", reason: "computer_use is GUI scripting" };

  if (tool === "memory_remember" || tool === "memory_forget") {
    return { tier: "low", reason: "memory mutation stays inside the local memory dir" };
  }

  return { tier: "medium", reason: "unknown tool defaults to ask" };
}
