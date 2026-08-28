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
      status: "unsupported";
      routeId: "microsoft-ufo.web-unsupported.v1" | "google-search.secret-blocked.v1";
      taskKind: "google_search";
      requestedExecutor: "microsoft_ufo" | "ava_chrome";
      reason: string;
      userMessage: string;
    };

const DIRECT_GOOGLE_PATTERNS = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+open\s+(?:google|chrome)(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+(?:google|the\s+web))?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?open\s+(?:google|chrome)(?:\s+for\s+me)?\s+(?:and|then)\s+search(?:\s+(?:google|the\s+web))?(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?search\s+google(?:\s+for)?\s+(.+)$/i,
  /^(?:please\s+)?google\s+(.+)$/i,
];

const COMPOUND_FOLLOW_UP =
  /\b(?:and|then)\s+(?:summari[sz]e|tell\s+me|compare|read|research|investigate|collect|write|save|download|click|open|explain|answer|find\s+out)\b/i;
const UFO_REQUEST = /\b(?:use|with|via|through)\s+(?:microsoft\s+)?ufo\b/i;
const WEB_REQUEST = /\b(?:google|web|browser|website|chrome|search\s+(?:online|the\s+web))\b/i;

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
  if (!query) return null;
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
    considered: [
      {
        executor: "ava_chrome",
        selected: true,
        reason: "The dedicated browser can open and verify the exact Google search URL directly.",
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
    ],
  };
}
