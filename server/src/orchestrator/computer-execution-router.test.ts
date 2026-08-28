import { describe, expect, it } from "vitest";
import { planComputerExecution } from "./computer-execution-router.js";

describe("planComputerExecution", () => {
  it.each([
    ["Open Google and search for northern lights tonight", "northern lights tonight"],
    ["please open chrome then search the web for AVA test phrase", "AVA test phrase"],
    ["Can you open Google for me and search fish and chips?", "fish and chips?"],
    ["search Google for accessible React graph libraries", "accessible React graph libraries"],
    ["Google weather in London", "weather in London"],
  ])("routes a direct search through persistent AVA Chrome: %s", (request, query) => {
    expect(planComputerExecution(request)).toMatchObject({
      status: "execute",
      routeId: "google-search.direct.v1",
      executor: "ava_chrome",
      toolName: "chrome_google_search",
      args: { query },
    });
  });

  it("keeps compound research on the normal agent path", () => {
    expect(planComputerExecution("Open Google and search for UFO, then summarize the best three sources")).toBeNull();
    expect(planComputerExecution("Search Google for React Flow and compare it with ELK")).toBeNull();
  });

  it("does not hijack unrelated browser or native-app tasks", () => {
    expect(planComputerExecution("Open Instagram and message Lasha")).toBeNull();
    expect(planComputerExecution("Open Notepad and write hello")).toBeNull();
    expect(planComputerExecution("Research the history of Google")).toBeNull();
  });

  it("fails honestly when UFO is explicitly requested for web work", () => {
    expect(planComputerExecution("Use Microsoft UFO to open Google and search for AVA")).toMatchObject({
      status: "unsupported",
      routeId: "microsoft-ufo.web-unsupported.v1",
      requestedExecutor: "microsoft_ufo",
    });
  });

  it("blocks a credential-shaped query before network disclosure", () => {
    expect(planComputerExecution("Open Google and search for sk-abcdefghijklmnopqrstuvwxyz123456")).toMatchObject({
      status: "unsupported",
      routeId: "google-search.secret-blocked.v1",
    });
  });
});
