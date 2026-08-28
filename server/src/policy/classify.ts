import { matchDestructive, isAllowed as shellAllowed } from "../tools/shell-allowlist.js";

export type Tier = "read-only" | "low" | "medium" | "high" | "blocked";

export type Classification = { tier: Tier; reason: string };

const READ_ONLY_TOOLS = new Set([
  "fs_read", "fs_list", "fs_stat",
  "chrome_read_page", "chrome_screenshot", "chrome_tabs", "chrome_snapshot",
  "memory_read",
  "memory_index_search",
  "memory_index_open",
  // Pure reads that previously fell through to the unknown-tool default
  // ("medium" → ask) and paid a 15s veto stall on EVERY call — the API tools
  // added for speed were the slowest to start. All of these only read state.
  "read_logs", "read_claude_updates", "read_discussion", "self_improve_status",
  "find_places", "shopify_list_products", "shopify_get_product",
  "watch_list", "person_list",
  "notes_search",
  "visual_explanation_list",
]);

const ENV_RE = /(^|[\\/])\.env(\.[\w-]+)?$|[\\/]\.env([\\/]|$)/i;
const HARD_BLOCKED_FLAGS = ["--dangerously-skip-permissions"];

// App-launch / file-open idioms Sir uses constantly (WhatsApp, Spotify, opening a
// folder, launching VS Code). These are classified "low" so enforce.ts auto-allows
// them instantly — no 15s approval stall.
const LAUNCH_SHELL = /^\s*(start\b|explorer\b|code\b)/i;

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

  if (
    tool === "chrome_open" ||
    tool === "chrome_navigate" ||
    tool === "chrome_type" ||
    tool === "chrome_press_key"
  ) {
    return { tier: "low", reason: "low-risk chrome action" };
  }

  if (tool === "chrome_click") {
    const sel = strs.join(" ");
    if (SUBMIT_LIKE.test(sel)) return { tier: "high", reason: "submit/checkout-like selector" };
    return { tier: "low", reason: "non-submit click" };
  }

  if (tool === "claude_code") return { tier: "medium", reason: "claude_code modifies code" };

  // Background read-only repo consult (spawns a local `claude -p` with no write
  // permissions). Instant — queueing a consult is not a risky act.
  if (tool === "discuss_with_claude") return { tier: "low", reason: "read-only background consult" };
  if (tool === "strategy_room_open") return { tier: "low", reason: "bounded read-only Strategy Room discussion" };
  if (tool === "visual_explanation_create" || tool === "research_visual_create") {
    return { tier: "low", reason: "validated local visual revision" };
  }

  // Mutates live store products — keep Sir's veto window.
  if (tool === "shopify_update_product") return { tier: "medium", reason: "mutates live Shopify products" };

  if (tool === "shell") {
    const cmd = strs.join(" ");
    // .env / secret access is hard-blocked at the shell gate; mirror that here so
    // an undecided approval can never auto-allow it (defense in depth — the top
    // ENV_RE only catches path-shaped .env, this also catches bare `cat .env`).
    const gate = shellAllowed(cmd);
    if (!gate.allowed && /\.env/i.test(gate.reason)) {
      return { tier: "blocked", reason: gate.reason };
    }
    // Destructive ops stay high-risk so "ask" keeps Sir's veto.
    const destructive = matchDestructive(cmd);
    if (destructive) return { tier: "high", reason: `destructive shell pattern: ${destructive.source}` };
    // Launching apps / opening files is instant, no friction.
    if (LAUNCH_SHELL.test(cmd)) return { tier: "low", reason: "app-launch / open command" };
    // Sir authorized full machine access — all other shell auto-allows.
    return { tier: "low", reason: "shell on Sir's authorized machine" };
  }

  if (tool === "computer_use") return { tier: "medium", reason: "computer_use is GUI scripting" };

  if (tool === "control_app") {
    // control_app runs PowerShell (UI Automation + SendKeys) locally. The
    // top-level ENV_RE guard already blocks `.env`. Reuse the shell safety net:
    // a destructive script keeps Sir's veto (high); anything else auto-allows
    // instantly (low) so local app control has no 15s approval stall.
    const script = String((args as { script?: unknown })?.script ?? "");
    const destructive = matchDestructive(script);
    if (destructive) return { tier: "high", reason: "destructive control_app script" };
    return { tier: "low", reason: "local app control" };
  }

  // Desktop capture writes only inside the Downloads/Ava/screenshots dir (the tool
  // rejects any other output path), so it is a low-risk local write — available
  // without a high-risk gate, but not silent/read-only since it captures the screen.
  if (tool === "take_screenshot") {
    return { tier: "low", reason: "desktop screenshot saved inside Downloads/Ava/screenshots" };
  }

  // Same capture pathway plus a vision call describing it back to Ava. Reading
  // Sir's own screen is exactly as sensitive as take_screenshot — low, no 15s
  // approval stall (live session 2026-07-03: 11 stalled look approvals turned a
  // 30-second task into minutes of waiting).
  if (tool === "look_at_screen") {
    return { tier: "low", reason: "screen capture + vision describe (read of Sir's own screen)" };
  }

  // Watch bookkeeping mutates only local scheduler rows; the real actions run
  // later through the normal policy gates. Creating/removing a schedule Sir
  // just asked for should not stall.
  if (tool === "watch_create" || tool === "watch_delete") {
    return { tier: "low", reason: "local watch schedule bookkeeping" };
  }

  // App modules. Sends are Sir-initiated with Sir's words (the rubric forbids
  // autonomous sends), and speed is the point — low, no 15s stall. Login/code
  // fill forms in Ava's own browser with values Sir just provided; the people
  // map is local data.
  if (/^(instagram|whatsapp)_(send_dm|send_message|open_profile|open_chat|read_chat|status|login|submit_code)$/.test(tool)) {
    return { tier: "low", reason: "app-module action Sir initiated" };
  }
  if (tool === "person_remember") return { tier: "low", reason: "local people-map update" };

  if (
    tool === "memory_remember" || tool === "memory_forget"
    || tool === "memory_index_capture" || tool === "memory_index_forget"
  ) {
    return { tier: "low", reason: "memory mutation stays inside local AVA state" };
  }

  if (tool === "notes_capture" || tool === "notes_update" || tool === "notes_promote") {
    return { tier: "low", reason: "Notes mutation stays in local AVA state; downstream improvements retain their own approval gate" };
  }

  return { tier: "medium", reason: "unknown tool defaults to ask" };
}
