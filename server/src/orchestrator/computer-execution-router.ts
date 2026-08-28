import { scrubSecrets } from "../security/scrub.js";

export type ComputerExecutor =
  | "ava_chrome"
  | "native_control"
  | "vision_computer_use"
  | "microsoft_ufo";

export type ComputerExecutionPlan =
  | {
      status: "execute";
      routeId: "google-search.direct.v1";
      taskKind: "google_search";
      executor: "ava_chrome";
      toolName: "chrome_google_search";
      args: { query: string };
      reason: string;
      considered: Array<{
        executor: ComputerExecutor;
        selected: boolean;
        reason: string;
      }>;
    }
  | {
      status: "execute";
      routeId: "website-open.direct.v1";
      taskKind: "website_open";
      executor: "ava_chrome";
      toolName: "chrome_open_url";
      args: { url: string };
      reason: string;
      considered: Array<{
        executor: ComputerExecutor;
        selected: boolean;
        reason: string;
      }>;
    }
  | {
      status: "execute";
      routeId: "youtube-search.direct.v1";
      taskKind: "youtube_search";
      executor: "ava_chrome";
      toolName: "chrome_youtube_search";
      args: { query: string };
      reason: string;
      considered: Array<{
        executor: ComputerExecutor;
        selected: boolean;
        reason: string;
      }>;
    }
  | {
      status: "unsupported";
      routeId:
        | "microsoft-ufo.web-unsupported.v1"
        | "google-search.secret-blocked.v1"
        | "youtube-search.secret-blocked.v1"
        | "website-open.secret-blocked.v1"
        | "website-open.invalid-target.v1";
      taskKind: "google_search" | "youtube_search" | "website_open";
      requestedExecutor: "microsoft_ufo" | "ava_chrome";
      reason: string;
      userMessage: string;
    };

export const KNOWN_BROWSER_SITES = {
  google: "https://www.google.com/",
  youtube: "https://www.youtube.com/",
  gmail: "https://mail.google.com/",
  reddit: "https://www.reddit.com/",
  github: "https://github.com/",
  wikipedia: "https://www.wikipedia.org/",
  "google maps": "https://www.google.com/maps",
} as const;

const DIRECT_GOOGLE_PATTERNS = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+open\s+(?:google|chrome)(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+(?:google|the\s+web))?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?open\s+(?:google|chrome)(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+(?:google|the\s+web))?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?search\s+google(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?google\s+(.+)$/i,
];

const DIRECT_YOUTUBE_PATTERNS = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+open\s+youtube(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+youtube)?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?open\s+youtube(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+youtube)?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?search\s+youtube(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?youtube\s+search(?:\s+for)?\s+(.+)$/i,
];

const DIRECT_OPEN_PATTERNS = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:open|visit|go\s+to|navigate\s+to)\s+(.+?)(?:\s+for\s+me)?[.!]?$/i,
  /^(?:please\s+)?(?:open|visit|go\s+to|navigate\s+to)\s+(.+?)(?:\s+for\s+me)?[.!]?$/i,
];

const COMPOUND_FOLLOW_UP =
  /\b(?:and|then)\s+(?:summari[sz]e|tell\s+me|compare|read|research|investigate|collect|write|save|download|click|open|play|log\s+in|sign\s+in|send|message|post|upload|explain|answer|find\s+out)\b/i;
const UFO_REQUEST = /\b(?:use|with|via|through)\s+(?:microsoft\s+)?ufo\b/i;
const WEB_REQUEST = /\b(?:google|youtube|gmail|reddit|github|wikipedia|web|browser|website|chrome|https?|search\s+(?:online|the\s+web))\b/i;

function directGoogleQuery(request: string): string | null {
  const normalized = request.replace(/\s+/g, " ").trim();
  for (const pattern of DIRECT_GOOGLE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match?.[1]) continue;
    const query = match[1].trim();
    if (!query || query.length > 500 || COMPOUND_FOLLOW_UP.test(query)) return null;
    return query;
  }
  return null;
}

function directYouTubeQuery(request: string): string | null {
  for (const pattern of DIRECT_YOUTUBE_PATTERNS) {
    const match = pattern.exec(request);
    if (!match?.[1]) continue;
    const query = match[1].trim();
    if (!query || query.length > 500 || COMPOUND_FOLLOW_UP.test(query)) return null;
    return query;
  }
  return null;
}

type OpenTarget =
  | { status: "ready"; url: string }
  | { status: "invalid"; reason: string };

function normalizeWebsiteTarget(raw: string): OpenTarget | null {
  const trimmed = raw.trim();
  if (!trimmed || COMPOUND_FOLLOW_UP.test(trimmed) || /\s+(?:and|then)\s+/i.test(trimmed)) return null;

  const alias = trimmed
    .replace(/[.!]$/, "")
    .replace(/^(?:the\s+)/i, "")
    .replace(/\s+(?:website|site|homepage)$/i, "")
    .trim()
    .toLocaleLowerCase();
  const known = KNOWN_BROWSER_SITES[alias as keyof typeof KNOWN_BROWSER_SITES];
  if (known) return { status: "ready", url: known };

  let candidate = trimmed;
  if (/^(?:www\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(?:[/?#].*)?$/i.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    return null;
  }

  if (candidate.length > 2_048) {
    return { status: "invalid", reason: "The requested URL exceeds AVA's 2,048-character browser limit." };
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { status: "invalid", reason: "Only explicit HTTP or HTTPS destinations can use the direct browser route." };
    }
    if (!url.hostname || url.username || url.password) {
      return { status: "invalid", reason: "The destination is missing a host or embeds credentials." };
    }
    return { status: "ready", url: url.toString() };
  } catch {
    return { status: "invalid", reason: "The requested destination is not a valid URL." };
  }
}

function directWebsiteTarget(request: string): OpenTarget | null {
  for (const pattern of DIRECT_OPEN_PATTERNS) {
    const match = pattern.exec(request);
    if (match?.[1]) return normalizeWebsiteTarget(match[1]);
  }
  return null;
}

function directBrowserConsidered(operation: string): Array<{
  executor: ComputerExecutor;
  selected: boolean;
  reason: string;
}> {
  return [
    {
      executor: "ava_chrome",
      selected: true,
      reason: `The persistent browser can ${operation} directly and verify its active URL.`,
    },
    {
      executor: "vision_computer_use",
      selected: false,
      reason: "Visual clicking would add latency and ambiguity to a deterministic URL operation.",
    },
    {
      executor: "microsoft_ufo",
      selected: false,
      reason: "The current UFO adapter supports only the fixed Notepad proof, not browser tasks.",
    },
  ];
}

/**
 * Select only task families whose route is deterministic enough to execute
 * before the model. Everything else remains on AVA's ordinary provider/tool
 * loop; this is a narrow fast path, not a second orchestration system.
 */
export function planComputerExecution(request: string): ComputerExecutionPlan | null {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  if (UFO_REQUEST.test(normalized) && WEB_REQUEST.test(normalized)) {
    return {
      status: "unsupported",
      routeId: "microsoft-ufo.web-unsupported.v1",
      taskKind: "google_search",
      requestedExecutor: "microsoft_ufo",
      reason: "The installed Microsoft UFO adapter accepts only AVA's fixed disposable Notepad proof.",
      userMessage:
        "I didn't run Microsoft UFO, Sir. Its current AVA adapter is limited to the fixed disposable Notepad proof and cannot operate Google or a browser. AVA Chrome is the supported fast route for this task.",
    };
  }

  const query = directGoogleQuery(normalized);
  if (query) {
    if (scrubSecrets(query) !== query) {
      return {
        status: "unsupported",
        routeId: "google-search.secret-blocked.v1",
        taskKind: "google_search",
        requestedExecutor: "ava_chrome",
        reason: "The search query contains material recognized by AVA's secret scrubber.",
        userMessage:
          "I didn't send that query to Google, Sir, because it appears to contain a credential or secret. Remove the sensitive value and I can search safely.",
      };
    }

    return {
      status: "execute",
      routeId: "google-search.direct.v1",
      taskKind: "google_search",
      executor: "ava_chrome",
      toolName: "chrome_google_search",
      args: { query },
      reason: "A direct persistent-browser URL is faster and more precise than visual desktop control.",
      considered: directBrowserConsidered("open the exact Google search URL"),
    };
  }

  const youtubeQuery = directYouTubeQuery(normalized);
  if (youtubeQuery) {
    if (scrubSecrets(youtubeQuery) !== youtubeQuery) {
      return {
        status: "unsupported",
        routeId: "youtube-search.secret-blocked.v1",
        taskKind: "youtube_search",
        requestedExecutor: "ava_chrome",
        reason: "The search query contains material recognized by AVA's secret scrubber.",
        userMessage:
          "I didn't send that query to YouTube, Sir, because it appears to contain a credential or secret. Remove the sensitive value and I can search safely.",
      };
    }
    return {
      status: "execute",
      routeId: "youtube-search.direct.v1",
      taskKind: "youtube_search",
      executor: "ava_chrome",
      toolName: "chrome_youtube_search",
      args: { query: youtubeQuery },
      reason: "YouTube search has a deterministic URL and does not need visual clicking or model planning.",
      considered: directBrowserConsidered("open the exact YouTube search URL"),
    };
  }

  const website = directWebsiteTarget(normalized);
  if (website?.status === "invalid") {
    return {
      status: "unsupported",
      routeId: "website-open.invalid-target.v1",
      taskKind: "website_open",
      requestedExecutor: "ava_chrome",
      reason: website.reason,
      userMessage: `I didn't open that destination, Sir. ${website.reason}`,
    };
  }
  if (website?.status === "ready") {
    if (scrubSecrets(website.url) !== website.url) {
      return {
        status: "unsupported",
        routeId: "website-open.secret-blocked.v1",
        taskKind: "website_open",
        requestedExecutor: "ava_chrome",
        reason: "The destination contains material recognized by AVA's secret scrubber.",
        userMessage:
          "I didn't open that URL, Sir, because it appears to contain a credential or secret. Remove the sensitive value and try again.",
      };
    }
    return {
      status: "execute",
      routeId: "website-open.direct.v1",
      taskKind: "website_open",
      executor: "ava_chrome",
      toolName: "chrome_open_url",
      args: { url: website.url },
      reason: "The requested destination is explicit and can be opened and verified without model planning.",
      considered: directBrowserConsidered("open the exact requested destination"),
    };
  }

  return null;
}

/*
 * Keep this helper at the end so route snapshots remain easy to compare in
 * reviews. No execution happens here; the ordinary agent tool boundary owns it.
 */
export function knownBrowserSite(name: string): string | null {
  const normalized = name.trim().toLocaleLowerCase();
  return KNOWN_BROWSER_SITES[normalized as keyof typeof KNOWN_BROWSER_SITES] ?? null;
}
