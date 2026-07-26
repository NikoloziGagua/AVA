import type { CapabilitySnapshot } from "../api.js";

export type CapabilityCategory =
  | "Everyday"
  | "Computer"
  | "Accounts"
  | "Memory"
  | "Automation"
  | "Build";

export type CapabilityState = "ready" | "offline" | "setup";

export type CapabilityDefinition = {
  id: string;
  category: CapabilityCategory;
  title: string;
  summary: string;
  examples: string[];
  status:
    | "brain"
    | "voice"
    | "browser"
    | "memory"
    | "instagram"
    | "whatsapp"
    | "gmailCalendar"
    | "screenVision"
    | "googlePlaces"
    | "shopify"
    | "watches"
    | "self";
};

export const CAPABILITY_CATEGORIES: Array<"All" | CapabilityCategory> = [
  "All",
  "Everyday",
  "Computer",
  "Accounts",
  "Memory",
  "Automation",
  "Build",
];

export const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "conversation",
    category: "Everyday",
    title: "Talk and reason",
    summary: "Natural text or live voice conversation, backed by GPT-5.6 for deeper work.",
    examples: ["Help me decide between two options", "Explain this simply", "Plan my day"],
    status: "brain",
  },
  {
    id: "voice",
    category: "Everyday",
    title: "Realtime voice",
    summary: "Interruptible speech-to-speech conversation with one consistent OpenAI voice.",
    examples: ["Talk through an idea", "Give me a spoken briefing", "Do this while I explain it"],
    status: "voice",
  },
  {
    id: "files",
    category: "Computer",
    title: "Files and shell",
    summary: "Read, create, edit, organize, search, build, and run work on this Windows PC.",
    examples: ["Organize my Downloads", "Create a report", "Run the project tests"],
    status: "brain",
  },
  {
    id: "browser",
    category: "Computer",
    title: "Persistent AVA Chrome",
    summary: "Open and drive the dedicated visible browser that keeps your logins between sessions.",
    examples: ["Open Chrome", "Research this product", "Fill in this form"],
    status: "browser",
  },
  {
    id: "screen",
    category: "Computer",
    title: "See the screen",
    summary: "Look at the desktop, describe what is open, and verify visual outcomes honestly.",
    examples: ["What is on my screen?", "Check whether that dialog succeeded"],
    status: "screenVision",
  },
  {
    id: "instagram",
    category: "Accounts",
    title: "Instagram",
    summary: "Open profiles, search safely, read chats, and send verified DMs through AVA Chrome.",
    examples: ["Open Lasha's Instagram", "Read my chat with …", "Send this exact message"],
    status: "instagram",
  },
  {
    id: "whatsapp",
    category: "Accounts",
    title: "WhatsApp",
    summary: "Find exact contacts, verify the opened chat, read it, and send only to the confirmed person.",
    examples: ["Open my chat with …", "Message … saying …", "Check if WhatsApp is linked"],
    status: "whatsapp",
  },
  {
    id: "google",
    category: "Accounts",
    title: "Gmail and Calendar",
    summary: "Use your logged-in Google account in AVA Chrome for mail, scheduling, and daily planning.",
    examples: ["Draft a reply", "Show today's calendar", "Schedule a meeting"],
    status: "gmailCalendar",
  },
  {
    id: "places",
    category: "Accounts",
    title: "Real places",
    summary: "Find businesses with addresses, phone numbers, websites, and map links.",
    examples: ["Find nearby restaurants", "Find businesses without a website"],
    status: "googlePlaces",
  },
  {
    id: "shopify",
    category: "Accounts",
    title: "Shopify products",
    summary: "List products and safely update product names or descriptions through the Admin API.",
    examples: ["List my products", "Improve this product description"],
    status: "shopify",
  },
  {
    id: "memory",
    category: "Memory",
    title: "Durable memory",
    summary: "Remember preferences, people, project roots, observations, and reusable workflows.",
    examples: ["Remember that …", "What do you know about me?", "Forget what I said about …"],
    status: "memory",
  },
  {
    id: "watches",
    category: "Automation",
    title: "Watches and reminders",
    summary: "Run scheduled checks, daily routines, and reminders, then notify you when something changes.",
    examples: ["Remind me at 6", "Tell me when the price drops", "Give me a daily briefing"],
    status: "watches",
  },
  {
    id: "self",
    category: "Build",
    title: "Improve itself",
    summary: "Queue isolated code improvements, verify them, ship them, and roll back unhealthy changes.",
    examples: ["Improve your chat search", "Show self-improvement status"],
    status: "self",
  },
  {
    id: "code",
    category: "Build",
    title: "Build software",
    summary: "Inspect repositories, implement features, debug failures, and run multi-step coding work.",
    examples: ["Debug this app", "Build this feature", "Review this codebase"],
    status: "brain",
  },
];

export type Mission = {
  id: string;
  title: string;
  eyebrow: string;
  prompt: string;
  requires?: "browser" | "screenVision";
};

export const MISSIONS: Mission[] = [
  {
    id: "memory-mirror",
    title: "Memory mirror",
    eyebrow: "KNOW YOUR AVA",
    prompt:
      "Tell me what you currently remember about my preferences, people, and active projects. " +
      "Explain where each type of memory comes from, and do not change anything.",
  },
  {
    id: "update-brief",
    title: "What changed?",
    eyebrow: "AVA CHANGELOG",
    prompt:
      "Read your recent Claude update log and summarize the three changes that are most useful to me.",
  },
  {
    id: "automation-scout",
    title: "Automation scout",
    eyebrow: "SAVE ME TIME",
    prompt:
      "Show me my active watches and reminders, then suggest one useful automation for today. " +
      "Do not create anything until I approve the idea.",
  },
  {
    id: "account-check",
    title: "Account readiness",
    eyebrow: "CONNECTED WORLD",
    prompt:
      "Check whether Instagram, WhatsApp, Gmail, and Calendar are available in AVA's persistent " +
      "Chrome. Do not send, post, delete, or change anything.",
    requires: "browser",
  },
  {
    id: "desktop-pulse",
    title: "Desktop pulse",
    eyebrow: "AVA'S EYES",
    prompt:
      "Look at my screen and give me a concise, factual summary of what is open and whether " +
      "anything appears to need my attention. Do not click or change anything.",
    requires: "screenVision",
  },
  {
    id: "side-quest",
    title: "Give me a side quest",
    eyebrow: "JUST FOR FUN",
    prompt:
      "Give me one surprising, fun, useful 20-minute side quest based on what you know about me. " +
      "Make it concrete and start with the first tiny step.",
  },
];

export function capabilityState(
  capability: CapabilityDefinition,
  snapshot: CapabilitySnapshot | null,
): CapabilityState {
  if (!snapshot) return "offline";
  switch (capability.status) {
    case "brain": return snapshot.core.brain.ready ? "ready" : "setup";
    case "voice": return snapshot.core.voice.ready ? "ready" : "setup";
    case "browser": return snapshot.core.browser.ready ? "ready" : "offline";
    case "memory": return snapshot.core.memory.ready ? "ready" : "offline";
    case "instagram": return snapshot.integrations.instagram ? "ready" : "offline";
    case "whatsapp": return snapshot.integrations.whatsapp ? "ready" : "offline";
    case "gmailCalendar": return snapshot.integrations.gmailCalendar ? "ready" : "offline";
    case "screenVision": return snapshot.integrations.screenVision ? "ready" : "setup";
    case "googlePlaces": return snapshot.integrations.googlePlaces ? "ready" : "setup";
    case "shopify": return snapshot.integrations.shopify ? "ready" : "setup";
    case "watches": return snapshot.automations.schedulerReady ? "ready" : "setup";
    case "self": return snapshot.automations.selfImprovement ? "ready" : "offline";
  }
}

export function filterCapabilities(
  query: string,
  category: "All" | CapabilityCategory,
): CapabilityDefinition[] {
  const needle = query.trim().toLowerCase();
  return CAPABILITIES.filter((capability) => {
    if (category !== "All" && capability.category !== category) return false;
    if (!needle) return true;
    return [
      capability.title,
      capability.summary,
      capability.category,
      ...capability.examples,
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

export function availableMissions(snapshot: CapabilitySnapshot | null): Mission[] {
  return MISSIONS.filter((mission) => {
    if (!mission.requires) return true;
    if (!snapshot) return false;
    if (mission.requires === "browser") return snapshot.core.browser.ready;
    return snapshot.integrations.screenVision;
  });
}

export function missionForDay(snapshot: CapabilitySnapshot | null, dayKey: string): Mission {
  const choices = availableMissions(snapshot);
  const hash = Array.from(dayKey).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return choices[hash % choices.length]!;
}
