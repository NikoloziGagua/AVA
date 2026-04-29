// Default policy: conversation. We only flip to "action" when the message
// carries a strong, unambiguous tool-use signal — explicit tool names, URLs,
// absolute file paths, or imperative verbs paired with a technical object.
// Ambiguous cases ("how's the build?", "is X working?") stay in conversation
// mode; the persona's rubric tells Ava to answer from memory and offer to
// check, rather than auto-executing.

export type Intent = "conversation" | "action";

const ARTICLE = "(?:the|a|my|this|that|those|these|all|some)";

const ACTION_PATTERNS: RegExp[] = [
  // Tool names — only the unambiguous, technical-looking variants. Bare
  // "chrome" or "shell" appear in casual sentences too often, so we require
  // them to appear inside an imperative phrase below instead.
  /\bclaude[\s_-]?code\b/i,
  /\bcomputer[\s_-]?use\b/i,
  /\bfs_(read|write|list|stat|delete)\b/i,
  /\bmemory_(remember|forget|read)\b/i,
  /\bchrome_(navigate|click|type|read_page|screenshot|tabs|press_key)\b/i,

  // URLs.
  /https?:\/\/\S+/i,

  // Absolute paths (Windows + POSIX) and explicit relative paths.
  /[A-Za-z]:[\\/]/,
  /(?:^|\s)\/(?:home|usr|opt|var|etc|tmp|root|bin|sbin|mnt|srv)\//i,
  /(?:^|\s)\.{1,2}\/\S+/,

  // Imperative + article + object — covers most action-style asks.
  new RegExp(`\\b(run|execute|launch|spawn|build|compile|deploy|install|kill|stop|start|restart|terminate|read|write|create|edit|modify|delete|remove|list|show|cat|tail|head|grep)\\s+${ARTICLE}\\s+\\S+`, "i"),

  // Imperative + recognized technical noun (article-less variants).
  /\b(run|execute|build|compile|test)\s+(tests?|server|build|app|project|script|migrations?|spec|specs|suite|lint|linter|formatter)\b/i,
  /\b(kill|stop|restart|terminate)\s+(server|process|build|chrome|node|app)\b/i,
  /\b(read|cat|tail|head)\s+(package\.json|readme(?:\.md)?|tsconfig\.json|\S+\.(?:md|json|ts|tsx|js|jsx|py|rs|go|sql|env))\b/i,

  // Open/navigate to chrome or a URL.
  /\bopen\s+chrome\b/i,
  /\b(navigate|go|browse)\s+to\s+(?:https?|www\.|[A-Za-z]:[\\/]|the\s+\w+)/i,

  /\btake\s+a?\s*screenshot/i,
  /\btype\s+["'`]/i,

  // Memory ops.
  /\b(remember|forget)\s+(that|what|everything|this|my)\b/i,
  /\bwhat\s+do\s+you\s+remember\b/i,

  // Direct "use X" phrasing — pulls bare "chrome"/"shell" into action mode
  // when the user explicitly invokes them.
  /\buse\s+(?:the\s+)?(claude[\s_-]?code|chrome|computer[\s_-]?use|shell|fs_|memory_)/i,
];

export function classifyIntent(message: string): Intent {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) return "conversation";
  for (const re of ACTION_PATTERNS) {
    if (re.test(trimmed)) return "action";
  }
  return "conversation";
}
