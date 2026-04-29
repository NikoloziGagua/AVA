import { describe, it, expect } from "vitest";
import { classifyIntent } from "./intent-classifier.js";

describe("classifyIntent", () => {
  it("treats greetings as conversation", () => {
    expect(classifyIntent("hi ava")).toBe("conversation");
    expect(classifyIntent("how are you, Ava?")).toBe("conversation");
    expect(classifyIntent("good morning")).toBe("conversation");
  });

  it("treats casual questions as conversation", () => {
    expect(classifyIntent("what's the weather like?")).toBe("conversation");
    expect(classifyIntent("how's the build?")).toBe("conversation");
    expect(classifyIntent("tell me about yourself")).toBe("conversation");
    expect(classifyIntent("what do you think of this approach?")).toBe("conversation");
  });

  it("treats explicit tool requests as action", () => {
    expect(classifyIntent("use claude_code to summarize this repo")).toBe("action");
    expect(classifyIntent("open chrome to news.ycombinator.com")).toBe("action");
    expect(classifyIntent("take a screenshot")).toBe("action");
  });

  it("treats messages with URLs as action", () => {
    expect(classifyIntent("check https://example.com")).toBe("action");
    expect(classifyIntent("navigate to http://localhost:8787")).toBe("action");
  });

  it("treats messages with absolute file paths as action", () => {
    expect(classifyIntent("read C:/ai/chemiapebi/yovlisshemdzle/package.json")).toBe("action");
    expect(classifyIntent("list C:\\Users\\nikug\\Downloads")).toBe("action");
    expect(classifyIntent("look at /usr/local/bin")).toBe("action");
  });

  it("treats run/execute/build imperatives as action", () => {
    expect(classifyIntent("run the tests")).toBe("action");
    expect(classifyIntent("execute the build script")).toBe("action");
    expect(classifyIntent("build the server")).toBe("action");
    expect(classifyIntent("kill the dev server")).toBe("action");
  });

  it("treats memory commands as action", () => {
    expect(classifyIntent("remember that I prefer pwsh")).toBe("action");
    expect(classifyIntent("forget what I said about VS Code")).toBe("action");
    expect(classifyIntent("what do you remember about my setup?")).toBe("action");
    expect(classifyIntent("forget everything about project yov")).toBe("action");
  });

  it("treats file ops imperatives as action", () => {
    expect(classifyIntent("read the package.json file")).toBe("action");
    expect(classifyIntent("write a hello world to scratch.txt")).toBe("action");
    expect(classifyIntent("list the files in the repo")).toBe("action");
  });

  it("does not flag casual mentions of action verbs", () => {
    // "Run" appears but not as an imperative on a technical object.
    expect(classifyIntent("how did your run go yesterday?")).toBe("conversation");
    expect(classifyIntent("the build is broken — any ideas why?")).toBe("conversation");
    expect(classifyIntent("I love how chrome looks at night")).toBe("conversation");
  });

  it("returns conversation for empty / whitespace input", () => {
    expect(classifyIntent("")).toBe("conversation");
    expect(classifyIntent("   ")).toBe("conversation");
  });

  it("is case-insensitive", () => {
    expect(classifyIntent("RUN THE TESTS")).toBe("action");
    expect(classifyIntent("Open Chrome")).toBe("action");
  });
});
