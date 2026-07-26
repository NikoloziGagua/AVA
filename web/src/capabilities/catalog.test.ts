import { describe, expect, it } from "vitest";
import type { CapabilitySnapshot } from "../api.js";
import {
  CAPABILITIES,
  availableMissions,
  capabilityState,
  filterCapabilities,
  missionForDay,
} from "./catalog.js";

const snapshot = {
  core: {
    brain: { ready: true, provider: "openai", model: "gpt-5.6" },
    voice: { ready: true, provider: "openai", model: "gpt-realtime-2.1", speaker: "marin" },
    browser: { ready: false, mode: "offline", helper: "scripts/start-ava-browser.cmd" },
    memory: { ready: true, preferences: 1, observations: 2, projects: 1, people: 1, playbooks: 3 },
  },
  integrations: {
    instagram: false,
    whatsapp: false,
    gmailCalendar: false,
    shopify: false,
    googlePlaces: true,
    screenVision: true,
    push: false,
  },
  automations: { watches: 2, schedulerReady: true, selfImprovement: true },
  generatedAt: 1,
  uptimeMs: 10,
} satisfies CapabilitySnapshot;

describe("capability catalog", () => {
  it("filters by category and natural-language search", () => {
    expect(filterCapabilities("", "Accounts").every((item) => item.category === "Accounts")).toBe(true);
    expect(filterCapabilities("message", "All").map((item) => item.id)).toContain("whatsapp");
  });

  it("marks browser-bound capabilities offline without hiding them", () => {
    const chrome = CAPABILITIES.find((item) => item.id === "browser")!;
    const memory = CAPABILITIES.find((item) => item.id === "memory")!;
    expect(capabilityState(chrome, snapshot)).toBe("offline");
    expect(capabilityState(memory, snapshot)).toBe("ready");
  });

  it("only launches missions whose required systems are ready", () => {
    const missions = availableMissions(snapshot);
    expect(missions.some((mission) => mission.id === "account-check")).toBe(false);
    expect(missions.some((mission) => mission.id === "desktop-pulse")).toBe(true);
    expect(missionForDay(snapshot, "2026-07-25")).toEqual(missionForDay(snapshot, "2026-07-25"));
  });
});
