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
  /\bmemory_index_(capture|search|open|forget)\b/i,
  /\bnotes?_(capture|search|update|promote)\b/i,
  /\bchrome_(open|open_url|google_search|youtube_search|navigate|click|type|read_page|screenshot|tabs|press_key)\b/i,

  // URLs.
  /https?:\/\/\S+/i,

  // Absolute paths (Windows + POSIX) and explicit relative paths.
  /[A-Za-z]:[\\/]/,
  /(?:^|\s)\/(?:home|usr|opt|var|etc|tmp|root|bin|sbin|mnt|srv)\//i,
  /(?:^|\s)\.{1,2}\/\S+/,

  // Imperative + article + object — covers most action-style asks (incl. common
  // spoken commands like "open my downloads", "play some music", "search the web").
  new RegExp(`\\b(run|execute|launch|spawn|build|compile|deploy|install|kill|stop|start|restart|terminate|read|write|create|edit|modify|delete|remove|list|show|cat|tail|head|grep|open|find|search|download|save|send|play|close|move|copy|rename|fetch|pull|push)\\s+${ARTICLE}\\s+\\S+`, "i"),

  // Imperative + recognized technical noun (article-less variants).
  /\b(run|execute|build|compile|test)\s+(tests?|server|build|app|project|script|migrations?|spec|specs|suite|lint|linter|formatter)\b/i,
  /\b(kill|stop|restart|terminate)\s+(server|process|build|chrome|node|app)\b/i,
  /\b(read|cat|tail|head)\s+(package\.json|readme(?:\.md)?|tsconfig\.json|\S+\.(?:md|json|ts|tsx|js|jsx|py|rs|go|sql|env))\b/i,

  // Open/navigate to Chrome or Google. The Google shape is a common spoken
  // command and must retain tools so voice reaches the same deterministic
  // computer route as typed chat.
  /\bopen\s+(?:chrome|google|youtube|gmail|reddit|github|wikipedia)\b/i,
  /\bsearch\s+(?:google|youtube)(?:\s+for)?\s+\S+/i,
  /\b(navigate|go|browse)\s+to\s+(?:https?|www\.|[A-Za-z]:[\\/]|the\s+\w+)/i,

  /\btake\s+a?\s*screenshot/i,
  /\btype\s+["'`]/i,

  // Memory ops. Catches "remember that/what/everything/this/my" plus first-
  // and second-person framings ("remember I…", "remember me", "remember you…").
  /\b(remember|forget)\s+(that|what|everything|this|my|i|i'm|me|you|you're|your)\b/i,
  /\bwhat\s+do\s+you\s+remember\b/i,
  /\b(index|capture|save)\s+(this|that|our)\s+(discussion|research|idea|decision)\b/i,
  /\bwhat\s+did\s+we\s+(decide|conclude|learn|research)\b/i,

  // Visible Notes workspace. This matters most for voice, whose conservative
  // classifier would otherwise strip tools from "put this in notes".
  /\b(put|save|add|capture|write)\b.{0,50}\b(?:in|to)\s+(?:my\s+|the\s+)?notes?\b/i,
  /\bmake\s+(?:a\s+)?note\s+(?:of|about)\b/i,

  // Direct "use X" phrasing — pulls bare "chrome"/"shell" into action mode
  // when the user explicitly invokes them.
  /\buse\s+(?:the\s+)?(claude[\s_-]?code|chrome|computer[\s_-]?use|shell|fs_|memory_|notes?_)/i,
];

export function classifyIntent(message: string): Intent {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) return "conversation";
  for (const re of ACTION_PATTERNS) {
    if (re.test(trimmed)) return "action";
  }
  return "conversation";
}

// ─── Typed-text routing ──────────────────────────────────────────────────────
// Voice trusts classifyIntent (conversation-biased) because misheard speech
// should not auto-execute. Typed text has the OPPOSITE cost asymmetry: sending
// a real task to conversation mode strips the tools and the run silently
// fails, while sending chitchat to action mode merely wastes a second. So a
// typed message is ACTION unless it is unmistakably chitchat: short, no action
// signals, and matching an explicit small-talk shape.
const CHITCHAT_PATTERNS: RegExp[] = [
  /^(hi|hey|heyy+|hello|yo|sup|good\s*(morning|afternoon|evening|night)|morning|gm|gn)\b[\s!.,]*$/i,
  /^(thanks?|thank\s+you|thx|ty|cheers|appreciated|nice|great|perfect|awesome|cool|amazing|lovely|beautiful|well\s+done|good\s+(job|work|girl))\b[\s!.,\w]{0,20}$/i,
  /^(ok|okay|okey|kk|sure|yes|yep|yeah|no|nope|nah|alright|fine|got\s+it|understood|sounds\s+good)\b[\s!.,]*$/i,
  /^(bye|goodbye|goodnight|see\s+you|later|cya|brb|talk\s+later)\b[\s!.,]*$/i,
  /^(how\s+are\s+you|how('s|\s+is)\s+it\s+going|what('s|\s+is)\s+up|you\s+(there|awake|up|around))\b.{0,15}$/i,
  /^(lol|haha+|lmao|xd|:\)|:d|<3|❤️|😂|👍|🙏)[\s!.,]*$/i,
];

export function classifyTypedIntent(message: string): Intent {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) return "conversation";
  if (trimmed.length > 60) return "action";
  if (classifyIntent(trimmed) === "action") return "action";
  for (const re of CHITCHAT_PATTERNS) {
    if (re.test(trimmed)) return "conversation";
  }
  return "action";
}
