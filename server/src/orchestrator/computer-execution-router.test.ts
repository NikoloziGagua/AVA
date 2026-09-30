import { describe, expect, it } from "vitest";
import { knownBrowserSite, planComputerExecution } from "./computer-execution-router.js";

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

  it.each([
    ["Open YouTube and search for ambient coding music", "ambient coding music"],
    ["search YouTube for AVA demos", "AVA demos"],
    ["YouTube search accessible React tutorials", "accessible React tutorials"],
  ])("routes one YouTube query directly: %s", (request, query) => {
    expect(planComputerExecution(request)).toMatchObject({
      status: "execute",
      routeId: "youtube-search.direct.v1",
      toolName: "chrome_youtube_search",
      args: { query },
    });
  });

  it.each([
    ["Open YouTube.", "https://www.youtube.com/"],
    ["please open the GitHub website", "https://github.com/"],
    ["Go to google maps", "https://www.google.com/maps"],
    ["Visit example.com/path?q=one", "https://example.com/path?q=one"],
    ["Navigate to https://example.com/docs#install", "https://example.com/docs#install"],
  ])("opens a declared site or explicit destination directly: %s", (request, url) => {
    expect(planComputerExecution(request)).toMatchObject({
      status: "execute",
      routeId: "website-open.direct.v1",
      toolName: "chrome_open_url",
      args: { url },
    });
  });

  it("keeps aliases data-driven and does not guess unknown brand domains", () => {
    expect(knownBrowserSite("reddit")).toBe("https://www.reddit.com/");
    expect(knownBrowserSite("some made up service")).toBeNull();
    expect(planComputerExecution("Open some made up service")).toBeNull();
  });

  it("keeps compound site/search work on the normal agent path", () => {
    expect(planComputerExecution("Open YouTube and search for AVA, then play the first video")).toBeNull();
    expect(planComputerExecution("Open github.com and summarize my notifications")).toBeNull();
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
    expect(planComputerExecution("Search YouTube for sk-abcdefghijklmnopqrstuvwxyz123456")).toMatchObject({
      status: "unsupported",
      routeId: "youtube-search.secret-blocked.v1",
    });
    expect(planComputerExecution("Open https://example.com/?token=sk-abcdefghijklmnopqrstuvwxyz123456")).toMatchObject({
      status: "unsupported",
      routeId: "website-open.secret-blocked.v1",
    });
  });

  it("rejects embedded credentials and unsupported URL schemes", () => {
    expect(planComputerExecution("Open https://user:password@example.com/private")).toMatchObject({
      status: "unsupported",
      routeId: "website-open.invalid-target.v1",
    });
    expect(planComputerExecution("Open javascript:alert(1)")).toMatchObject({
      status: "unsupported",
      routeId: "website-open.invalid-target.v1",
    });
  });
});
