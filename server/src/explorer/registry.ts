import type { CapabilitySnapshot } from "../routes/capabilities.js";

export type ExplorerDomain = {
  id: string;
  name: string;
  description: string;
};

export type ExplorerCapabilityEvidence = {
  kind: "configuration" | "runtime_probe" | "local_store" | "dependency";
  source: string;
  summary: string;
  observedAt: number;
};

export type ExplorerCapability = {
  id: string;
  domainId: string;
  name: string;
  description: string;
  stability: "stable" | "beta";
  moduleReference: string;
  dependencies: string[];
  verificationMethods: string[];
  readiness:
    | "ready"
    | "partially_ready"
    | "setup_required"
    | "unavailable"
    | "unknown";
  health: "healthy" | "degraded" | "unavailable" | "unknown";
  reason: string;
  statusConfidence: "high" | "medium" | "low";
  lastChecked: number;
  evidence: ExplorerCapabilityEvidence[];
};

export const EXPLORER_DOMAINS: ExplorerDomain[] = [
  { id: "interaction", name: "Conversation", description: "Text, reasoning, and realtime voice." },
  { id: "computer", name: "Computer", description: "Browser, desktop, shell, files, and vision." },
  { id: "accounts", name: "Connected accounts", description: "Account-backed communication and services." },
  { id: "knowledge", name: "Memory", description: "Durable memory, people, and reusable procedures." },
  { id: "automation", name: "Automation", description: "Scheduled work, notifications, and self-improvement." },
  { id: "development", name: "Development", description: "Coding and project execution." },
];

type StaticCapability = Omit<
  ExplorerCapability,
  "readiness" | "health" | "reason" | "statusConfidence" | "lastChecked" | "evidence"
>;

const DEFINITIONS: StaticCapability[] = [
  {
    id: "conversation",
    domainId: "interaction",
    name: "Talk and reason",
    description: "Natural text conversation and request interpretation.",
    stability: "stable",
    moduleReference: "server/src/orchestrator",
    dependencies: [],
    verificationMethods: ["Configured LLM provider", "Completed chat task"],
  },
  {
    id: "voice",
    domainId: "interaction",
    name: "Realtime voice",
    description: "Interruptible speech-to-speech conversation.",
    stability: "beta",
    moduleReference: "server/src/routes/voice-realtime.ts",
    dependencies: ["conversation"],
    verificationMethods: ["Provider session connection", "Audio round-trip"],
  },
  {
    id: "files",
    domainId: "computer",
    name: "Files and shell",
    description: "Read, create, edit, organise, search, and execute local work.",
    stability: "stable",
    moduleReference: "server/src/tools/filesystem-mcp.ts",
    dependencies: ["conversation"],
    verificationMethods: ["Tool result", "File existence or hash", "Shell exit code"],
  },
  {
    id: "browser",
    domainId: "computer",
    name: "Persistent AVA Chrome",
    description: "Open and control AVA's dedicated logged-in browser.",
    stability: "beta",
    moduleReference: "server/src/tools/chrome-mcp.ts",
    dependencies: ["conversation"],
    verificationMethods: ["CDP runtime probe", "DOM or screenshot evidence"],
  },
  {
    id: "screen",
    domainId: "computer",
    name: "See the screen",
    description: "Capture and inspect the visible desktop.",
    stability: "beta",
    moduleReference: "server/src/tools/screenshot",
    dependencies: ["conversation"],
    verificationMethods: ["Screenshot artifact", "Vision tool result"],
  },
  {
    id: "instagram",
    domainId: "accounts",
    name: "Instagram",
    description: "Open profiles, read chats, and send verified direct messages.",
    stability: "beta",
    moduleReference: "server/src/apps/instagram.ts",
    dependencies: ["browser"],
    verificationMethods: ["Authenticated session check", "Verified conversation header", "Visible sent message"],
  },
  {
    id: "whatsapp",
    domainId: "accounts",
    name: "WhatsApp",
    description: "Open, read, and send messages to a verified contact.",
    stability: "beta",
    moduleReference: "server/src/apps/whatsapp.ts",
    dependencies: ["browser"],
    verificationMethods: ["Linked session check", "Verified chat header", "Visible sent message"],
  },
  {
    id: "google",
    domainId: "accounts",
    name: "Gmail and Calendar",
    description: "Use logged-in Google services through AVA Chrome.",
    stability: "beta",
    moduleReference: "server/src/tools/chrome-mcp.ts",
    dependencies: ["browser"],
    verificationMethods: ["Authenticated page", "DOM confirmation"],
  },
  {
    id: "places",
    domainId: "accounts",
    name: "Real places",
    description: "Find businesses and places through the configured Places API.",
    stability: "stable",
    moduleReference: "server/src/tools/places-mcp.ts",
    dependencies: ["conversation"],
    verificationMethods: ["Successful API response"],
  },
  {
    id: "shopify",
    domainId: "accounts",
    name: "Shopify products",
    description: "Read and safely update products through Shopify Admin.",
    stability: "beta",
    moduleReference: "server/src/tools/shopify-mcp.ts",
    dependencies: ["conversation"],
    verificationMethods: ["Successful API response", "Read-after-write result"],
  },
  {
    id: "memory",
    domainId: "knowledge",
    name: "Durable memory",
    description: "Preferences, observations, people, projects, and procedures.",
    stability: "stable",
    moduleReference: "server/src/memory",
    dependencies: [],
    verificationMethods: ["Readable local memory store", "Read-after-write"],
  },
  {
    id: "watches",
    domainId: "automation",
    name: "Watches and reminders",
    description: "Scheduled checks, routines, and reminders.",
    stability: "beta",
    moduleReference: "server/src/watches/scheduler.ts",
    dependencies: ["conversation"],
    verificationMethods: ["Scheduler availability", "Recorded watch run"],
  },
  {
    id: "push",
    domainId: "automation",
    name: "Push notifications and approvals",
    description: "Notify the owner and resolve policy-gated actions.",
    stability: "beta",
    moduleReference: "server/src/push",
    dependencies: ["conversation"],
    verificationMethods: ["Push configuration", "Recorded approval resolution"],
  },
  {
    id: "self",
    domainId: "automation",
    name: "Improve itself",
    description: "Queue, verify, ship, and roll back isolated improvements.",
    stability: "beta",
    moduleReference: "server/src/self",
    dependencies: ["code"],
    verificationMethods: ["Verification suite", "Commit", "Post-swap health check"],
  },
  {
    id: "code",
    domainId: "development",
    name: "Build software",
    description: "Inspect repositories, implement features, debug, and test.",
    stability: "stable",
    moduleReference: "server/src/tools/claude-code-mcp.ts",
    dependencies: ["conversation", "files"],
    verificationMethods: ["Diff", "Build or test exit code"],
  },
];

export function capabilityIdsForTool(tool: string): string[] {
  if (tool === "instagram_send_dm") {
    return ["instagram.send-dm", "instagram.messaging", "browser.persistent-control"];
  }
  if (/^instagram_(status|login|submit_code)$/.test(tool)) {
    return ["instagram.connection", "instagram.messaging", "browser.persistent-control"];
  }
  if (/^instagram_/.test(tool)) {
    return ["instagram.messaging", "browser.persistent-control"];
  }
  if (tool === "whatsapp_send_message") {
    return ["whatsapp.send-message", "whatsapp.messaging", "browser.persistent-control"];
  }
  if (tool === "whatsapp_status") {
    return ["whatsapp.connection", "whatsapp.messaging", "browser.persistent-control"];
  }
  if (/^whatsapp_/.test(tool)) {
    return ["whatsapp.messaging", "browser.persistent-control"];
  }
  if (/^person_/.test(tool)) return ["people.identity-resolution"];
  if (/^notes_/.test(tool)) return ["memory.structured-notes"];
  if (tool === "strategy_room_open") return ["conversation.strategy-room"];
  if (/^visual_explanation_/.test(tool)) return ["interface.visual-explanations"];
  if (/^memory_/.test(tool)) return ["memory.durable"];
  if (/^watch_/.test(tool)) return ["automation.watches"];
  if (/^shopify_/.test(tool)) return ["services.shopify-products"];
  if (tool === "find_places") return ["services.google-places"];
  if (/^chrome_/.test(tool) || tool === "computer_use") return ["browser.persistent-control"];
  if (tool === "control_app") return ["desktop.native-control"];
  if (tool === "do_on_computer") return ["voice.realtime"];
  if (tool === "read_logs") return ["verification.outcome-evidence"];
  if (tool === "take_screenshot" || tool === "look_at_screen") {
    return ["vision.screen-inspection"];
  }
  if (/^fs_/.test(tool)) return ["shell-files.filesystem"];
  if (tool === "shell") return ["shell-files.shell"];
  if (tool === "claude_code") return ["coding.project-work"];
  if (/^self_improve/.test(tool)) return ["self-improvement.pipeline"];
  if (/^discuss_/.test(tool) || tool === "read_discussion" || tool === "read_claude_updates") {
    return ["developer-collaboration.claude"];
  }
  return [];
}

function evidence(
  kind: ExplorerCapabilityEvidence["kind"],
  source: string,
  summary: string,
  observedAt: number,
): ExplorerCapabilityEvidence[] {
  return [{ kind, source, summary, observedAt }];
}

export function deriveExplorerCapabilities(
  snapshot: CapabilitySnapshot,
): ExplorerCapability[] {
  const checkedAt = snapshot.generatedAt;
  return DEFINITIONS.map((definition): ExplorerCapability => {
    const base = { ...definition, lastChecked: checkedAt };
    switch (definition.id) {
      case "conversation": {
        const ready = snapshot.core.brain.ready;
        return {
          ...base,
          readiness: ready ? "ready" : "setup_required",
          health: ready ? "unknown" : "unavailable",
          reason: ready
            ? "An LLM provider is configured; this check does not make a live model request."
            : "No LLM provider is configured.",
          statusConfidence: "high",
          evidence: evidence(
            "configuration",
            "capability_snapshot.core.brain",
            ready ? "Provider configuration is present." : "Provider configuration is absent.",
            checkedAt,
          ),
        };
      }
      case "voice": {
        const ready = snapshot.core.voice.ready;
        return {
          ...base,
          readiness: ready ? "partially_ready" : "setup_required",
          health: ready ? "unknown" : "unavailable",
          reason: ready
            ? "Voice credentials are configured; no live audio round-trip was run."
            : "No supported voice provider is configured.",
          statusConfidence: "high",
          evidence: evidence(
            "configuration",
            "capability_snapshot.core.voice",
            `${snapshot.core.voice.provider} / ${snapshot.core.voice.model} configuration ${ready ? "present" : "absent"}.`,
            checkedAt,
          ),
        };
      }
      case "browser": {
        const ready = snapshot.core.browser.ready;
        const attached = ready && snapshot.core.browser.mode === "attached";
        return {
          ...base,
          readiness: attached ? "ready" : ready ? "partially_ready" : "unavailable",
          health: attached ? "healthy" : ready ? "unknown" : "unavailable",
          reason: attached
            ? "The configured AVA Chrome endpoint answered the full CDP runtime probe."
            : ready
              ? "AVA Chrome accepts local CDP connections, but its version probe did not complete in time."
              : "AVA Chrome did not answer the runtime probe.",
          statusConfidence: "high",
          evidence: evidence(
            "runtime_probe",
            "capability_snapshot.core.browser",
            `Browser runtime probe: ${snapshot.core.browser.mode}.`,
            checkedAt,
          ),
        };
      }
      case "instagram":
      case "whatsapp":
      case "google": {
        const browserReady = snapshot.core.browser.ready;
        return {
          ...base,
          readiness: browserReady ? "partially_ready" : "unavailable",
          health: browserReady ? "unknown" : "unavailable",
          reason: browserReady
            ? "AVA Chrome is available, but this check does not verify that the account is authenticated."
            : "The required AVA Chrome dependency is unavailable.",
          statusConfidence: "medium",
          evidence: evidence(
            "dependency",
            "capability_snapshot.core.browser",
            browserReady ? "Browser dependency passed." : "Browser dependency failed.",
            checkedAt,
          ),
        };
      }
      case "screen": {
        const configured = snapshot.integrations.screenVision;
        return {
          ...base,
          readiness: configured ? "partially_ready" : "setup_required",
          health: configured ? "unknown" : "unavailable",
          reason: configured
            ? "Screen vision is configured; no screenshot or vision call was made."
            : "Screen vision configuration is missing.",
          statusConfidence: "high",
          evidence: evidence(
            "configuration",
            "capability_snapshot.integrations.screenVision",
            configured ? "Vision configuration is present." : "Vision configuration is absent.",
            checkedAt,
          ),
        };
      }
      case "places":
      case "shopify": {
        const configured = definition.id === "places"
          ? snapshot.integrations.googlePlaces
          : snapshot.integrations.shopify;
        return {
          ...base,
          readiness: configured ? "partially_ready" : "setup_required",
          health: configured ? "unknown" : "unavailable",
          reason: configured
            ? "Credentials are configured; no live service request was made."
            : "Required service configuration is missing.",
          statusConfidence: "high",
          evidence: evidence(
            "configuration",
            `capability_snapshot.integrations.${definition.id === "places" ? "googlePlaces" : "shopify"}`,
            configured ? "Service configuration is present." : "Service configuration is absent.",
            checkedAt,
          ),
        };
      }
      case "memory": {
        const ready = snapshot.core.memory.ready;
        const counts = snapshot.core.memory;
        return {
          ...base,
          readiness: ready ? "ready" : "unavailable",
          health: ready ? "healthy" : "unavailable",
          reason: ready
            ? "The local memory store was read successfully."
            : "The local memory store could not be read.",
          statusConfidence: "high",
          evidence: evidence(
            "local_store",
            "capability_snapshot.core.memory",
            ready
              ? `Read ${counts.preferences} preferences, ${counts.observations} observations, ${counts.projects} projects, ${counts.people} people, and ${counts.playbooks} playbooks.`
              : "Memory store read failed.",
            checkedAt,
          ),
        };
      }
      case "watches": {
        const ready = snapshot.automations.schedulerReady;
        return {
          ...base,
          readiness: ready ? "partially_ready" : "setup_required",
          health: ready ? "unknown" : "unavailable",
          reason: ready
            ? "The scheduler can run and its configured watch count was read; no watch was executed."
            : "The scheduler lacks a configured LLM provider.",
          statusConfidence: "high",
          evidence: evidence(
            "local_store",
            "capability_snapshot.automations",
            `${snapshot.automations.watches} enabled watch(es) recorded.`,
            checkedAt,
          ),
        };
      }
      case "push": {
        const configured = snapshot.integrations.push;
        return {
          ...base,
          readiness: configured ? "partially_ready" : "setup_required",
          health: configured ? "unknown" : "unavailable",
          reason: configured
            ? "Push delivery is configured; no notification round-trip was attempted."
            : "Push delivery configuration is missing.",
          statusConfidence: "high",
          evidence: evidence(
            "configuration",
            "capability_snapshot.integrations.push",
            configured
              ? "Push delivery configuration is present."
              : "Push delivery configuration is absent.",
            checkedAt,
          ),
        };
      }
      case "self": {
        return {
          ...base,
          readiness: snapshot.automations.selfImprovement ? "partially_ready" : "unavailable",
          health: "unknown",
          reason: "The self-improvement subsystem is registered; no improvement run was executed.",
          statusConfidence: "medium",
          evidence: evidence(
            "configuration",
            "capability_snapshot.automations.selfImprovement",
            "Subsystem registration reported by the running server.",
            checkedAt,
          ),
        };
      }
      case "files":
      case "code": {
        const ready = snapshot.core.brain.ready;
        return {
          ...base,
          readiness: ready ? "partially_ready" : "setup_required",
          health: ready ? "unknown" : "unavailable",
          reason: ready
            ? "The orchestrator dependency is configured; no file, shell, or build action was run."
            : "These tools require a configured orchestrator.",
          statusConfidence: "medium",
          evidence: evidence(
            "dependency",
            "capability_snapshot.core.brain",
            ready ? "Orchestrator dependency is configured." : "Orchestrator dependency is missing.",
            checkedAt,
          ),
        };
      }
      default:
        return {
          ...base,
          readiness: "unknown",
          health: "unknown",
          reason: "No evidence adapter exists for this capability yet.",
          statusConfidence: "low",
          evidence: [],
        };
    }
  });
}
