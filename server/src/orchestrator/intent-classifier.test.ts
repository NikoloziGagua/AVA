import { describe, it, expect } from "vitest";
import { classifyIntent, classifyTypedIntent } from "./intent-classifier.js";

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
    expect(classifyIntent("remember I live in Ireland")).toBe("action");
    expect(classifyIntent("remember me as terse")).toBe("action");
    expect(classifyIntent("remember I'm allergic to dairy")).toBe("action");
    expect(classifyIntent("remember you should always confirm before pushing")).toBe("action");
    expect(classifyIntent("index this discussion")).toBe("action");
    expect(classifyIntent("capture our research")).toBe("action");
    expect(classifyIntent("what did we decide about memory?")).toBe("action");
  });

  it("keeps Notes capture available to conservative voice routing", () => {
    expect(classifyIntent("put this idea in my notes")).toBe("action");
    expect(classifyIntent("save that to the AVA project notes")).toBe("action");
    expect(classifyIntent("make a note about the browser issue")).toBe("action");
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

describe("classifyTypedIntent (action-biased for typed text)", () => {
  it("routes unmistakable chitchat to conversation", () => {
    expect(classifyTypedIntent("hey")).toBe("conversation");
    expect(classifyTypedIntent("good morning!")).toBe("conversation");
    expect(classifyTypedIntent("thanks!")).toBe("conversation");
    expect(classifyTypedIntent("thank you so much")).toBe("conversation");
    expect(classifyTypedIntent("ok")).toBe("conversation");
    expect(classifyTypedIntent("how are you?")).toBe("conversation");
    expect(classifyTypedIntent("goodnight")).toBe("conversation");
    expect(classifyTypedIntent("haha")).toBe("conversation");
  });

  it("keeps every task-shaped message on the action path", () => {
    // Verbs OUTSIDE the voice classifier's list must still get tools.
    expect(classifyTypedIntent("organize my downloads folder")).toBe("action");
    expect(classifyTypedIntent("summarize this pdf for me")).toBe("action");
    expect(classifyTypedIntent("book a table for two tomorrow")).toBe("action");
    expect(classifyTypedIntent("what's the weather in Batumi")).toBe("action");
    expect(classifyTypedIntent("remind me at 6pm to call Mom")).toBe("action");
  });

  it("length alone forces action (long messages are never chitchat)", () => {
    expect(classifyTypedIntent("thanks for everything you did yesterday, and also please check my calendar")).toBe("action");
  });

  it("action signals win even in short messages", () => {
    expect(classifyTypedIntent("open chrome")).toBe("action");
    expect(classifyTypedIntent("run the tests")).toBe("action");
  });

  it("empty input stays conversation", () => {
    expect(classifyTypedIntent("")).toBe("conversation");
  });
});
