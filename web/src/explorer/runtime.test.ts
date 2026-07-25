import { describe, expect, it } from "vitest";
import type { ExplorerRuntimeCapability } from "../api.js";
import { getCapability } from "./registry.js";
import {
  eventCapabilityIdsForAtlas,
  healthLabel,
  readinessLabel,
  runtimeForCapability,
} from "./runtime.js";

function runtime(
  patch: Partial<ExplorerRuntimeCapability> = {},
): ExplorerRuntimeCapability {
  return {
    id: "instagram",
    domainId: "accounts",
    name: "Instagram",
    description: "Instagram workflow",
    stability: "beta",
    moduleReference: "server/src/apps/instagram.ts",
    dependencies: ["browser"],
    verificationMethods: ["DOM confirmation"],
    readiness: "partially_ready",
    health: "unknown",
    reason: "AVA Chrome is available, but account authentication was not checked.",
    statusConfidence: "medium",
    lastChecked: 123,
    evidence: [{
      kind: "dependency",
      source: "capability_snapshot.core.browser",
      summary: "Browser dependency passed.",
      observedAt: 123,
    }],
    ...patch,
  };
}

describe("Explorer runtime evidence adapter", () => {
  it("keeps inherited domain evidence partial instead of promoting it to direct proof", () => {
    const capability = getCapability("instagram.send-dm");
    expect(capability).toBeDefined();
    const result = runtimeForCapability(capability!, [runtime()]);

    expect(result.readiness).toBe("partially_ready");
    expect(result.health).toBe("unknown");
    expect(result.sources).toEqual(["instagram"]);
    expect(result.reason).toContain("dependency-level evidence");
  });

  it("uses an exact runtime record without weakening its readiness", () => {
    const capability = getCapability("instagram.send-dm");
    expect(capability).toBeDefined();
    const exact = runtime({
      id: "instagram.send-dm",
      readiness: "ready",
      health: "healthy",
      reason: "Dedicated workflow probe passed.",
      statusConfidence: "high",
    });
    const result = runtimeForCapability(capability!, [exact]);

    expect(result.readiness).toBe("ready");
    expect(result.health).toBe("healthy");
    expect(result.confidence).toBe("high");
    expect(result.reason).toBe("Dedicated workflow probe passed.");
  });

  it("reports unknown when the registry has no runtime adapter", () => {
    const capability = getCapability("instagram.send-dm");
    expect(capability).toBeDefined();
    const result = runtimeForCapability(
      { ...capability!, id: "not-in-runtime-map" },
      [],
    );

    expect(result.readiness).toBe("unknown");
    expect(result.health).toBe("unknown");
    expect(result.checkedAt).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it("does not merge unrelated service readiness in the same domain", () => {
    const places = getCapability("services.google-places");
    const shopify = getCapability("services.shopify-products");
    expect(places).toBeDefined();
    expect(shopify).toBeDefined();

    const runtimeCapabilities = [
      runtime({
        id: "places",
        name: "Places",
        readiness: "partially_ready",
        health: "unknown",
        reason: "Places credentials are configured.",
      }),
      runtime({
        id: "shopify",
        name: "Shopify",
        readiness: "setup_required",
        health: "unavailable",
        reason: "Shopify configuration is missing.",
      }),
    ];

    expect(runtimeForCapability(places!, runtimeCapabilities).readiness).toBe(
      "partially_ready",
    );
    expect(runtimeForCapability(shopify!, runtimeCapabilities).readiness).toBe(
      "setup_required",
    );
  });

  it("does not use scheduler health as push-notification evidence", () => {
    const capability = getCapability("notifications.push-approvals");
    expect(capability).toBeDefined();
    const result = runtimeForCapability(capability!, [
      runtime({
        id: "watches",
        readiness: "partially_ready",
        health: "unknown",
        reason: "Scheduler is available.",
      }),
      runtime({
        id: "push",
        readiness: "setup_required",
        health: "unavailable",
        reason: "Push configuration is missing.",
      }),
    ]);

    expect(result.readiness).toBe("setup_required");
    expect(result.sources).toEqual(["push"]);
  });

  it("keeps legacy broad event IDs linked to their detailed capability", () => {
    const desktop = getCapability("desktop.native-control");
    expect(desktop).toBeDefined();
    expect(eventCapabilityIdsForAtlas(desktop!)).toEqual(
      expect.arrayContaining(["desktop.native-control", "desktop", "computer"]),
    );
  });

  it("uses plain-language labels for unmeasured state", () => {
    expect(readinessLabel("partially_ready")).toBe("Partially ready");
    expect(healthLabel("unknown")).toBe("Not tested live");
  });
});
