import { Router, type RequestHandler } from "express";
import type { Db } from "../state/db.js";
import { readMemoryView } from "../memory/file-view.js";
import { listPeople } from "../apps/people.js";
import { listPlaybooks } from "../playbooks/store.js";
import { listWatches } from "../state/watches.js";
import { getVoiceEngine } from "../state/voice-engine-pref.js";
import type { UfoExperimentHealth } from "../ufo/experiment.js";

export type BrowserReadiness = {
  ready: boolean;
  mode: "attached" | "reachable" | "offline";
};

export type CapabilitySnapshot = {
  generatedAt: number;
  uptimeMs: number;
  core: {
    brain: { ready: boolean; provider: string | null; model: string };
    voice: { ready: boolean; provider: "openai" | "hume"; model: string; speaker: string };
    browser: BrowserReadiness & { helper: string };
    memory: {
      ready: boolean;
      preferences: number;
      observations: number;
      projects: number;
      people: number;
      playbooks: number;
    };
  };
  integrations: {
    instagram: boolean;
    whatsapp: boolean;
    gmailCalendar: boolean;
    shopify: boolean;
    googlePlaces: boolean;
    screenVision: boolean;
    push: boolean;
    microsoftUfo: UfoExperimentHealth;
  };
  automations: {
    watches: number;
    schedulerReady: boolean;
    selfImprovement: boolean;
  };
};

export type CapabilityRouteDeps = {
  db: Db;
  startedAt: number;
  provider: string | null;
  memoryDir: string;
  browserReadiness: () => Promise<BrowserReadiness>;
  brainModel: string;
  voiceModel: string;
  voiceName: string;
  voiceReady: boolean;
  shopifyReady: boolean;
  googlePlacesReady: boolean;
  screenVisionReady: boolean;
  pushReady: boolean;
  ufoHealth: () => UfoExperimentHealth;
};

/**
 * Build the non-secret readiness snapshot shown by the Capability Center.
 * This never returns keys, account names, browser URLs, or memory contents.
 */
export async function buildCapabilitySnapshot(
  deps: CapabilityRouteDeps,
  now = Date.now(),
): Promise<CapabilitySnapshot> {
  let preferences = 0;
  let observations = 0;
  let projects = 0;
  let people = 0;
  let playbooks = 0;
  let memoryReady = true;
  try {
    const memory = readMemoryView(deps.memoryDir);
    preferences = memory.preferences.lines.length;
    observations = memory.observations.lines.length;
    projects = memory.projects.length;
    people = listPeople(deps.memoryDir).length;
    playbooks = listPlaybooks(deps.memoryDir).length;
  } catch {
    memoryReady = false;
  }

  let browser: BrowserReadiness = { ready: false, mode: "offline" };
  try {
    browser = await deps.browserReadiness();
  } catch {
    // Capability discovery must stay available even when the browser is the
    // broken component the owner came here to diagnose.
  }

  let watches = 0;
  try {
    watches = listWatches(deps.db).filter((watch) => !!watch.enabled).length;
  } catch {
    // A missing/migrating watches table should not break the whole snapshot.
  }

  return {
    generatedAt: now,
    uptimeMs: Math.max(0, now - deps.startedAt),
    core: {
      brain: {
        ready: deps.provider !== null,
        provider: deps.provider,
        model: deps.brainModel,
      },
      voice: {
        ready: deps.voiceReady,
        provider: getVoiceEngine(deps.db),
        model: deps.voiceModel,
        speaker: deps.voiceName,
      },
      browser: {
        ...browser,
        helper: "scripts/start-ava-browser.cmd",
      },
      memory: {
        ready: memoryReady,
        preferences,
        observations,
        projects,
        people,
        playbooks,
      },
    },
    integrations: {
      // These deterministic workflows use the same persistent browser.
      instagram: browser.ready,
      whatsapp: browser.ready,
      gmailCalendar: browser.ready,
      shopify: deps.shopifyReady,
      googlePlaces: deps.googlePlacesReady,
      screenVision: deps.screenVisionReady,
      push: deps.pushReady,
      microsoftUfo: deps.ufoHealth(),
    },
    automations: {
      watches,
      schedulerReady: deps.provider !== null,
      selfImprovement: true,
    },
  };
}

export function capabilityRoutes(
  auth: RequestHandler,
  deps: CapabilityRouteDeps,
): Router {
  const r = Router();
  r.get("/", auth, async (_req, res) => {
    res.json(await buildCapabilitySnapshot(deps));
  });
  return r;
}
