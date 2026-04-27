import { describe, it, expect } from "vitest";
import { scrubSecrets } from "./scrub.js";

describe("scrubSecrets", () => {
  it("redacts Anthropic-style keys", () => {
    expect(scrubSecrets("token: sk-ant-api03-AAAAAAAAAAAAAAAAAAAA")).toBe(
      "token: sk-ant-***",
    );
  });

  it("redacts OpenAI-style keys", () => {
    expect(scrubSecrets("OPENAI=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(
      "OPENAI=sk-***",
    );
  });

  it("redacts AWS access key IDs", () => {
    expect(scrubSecrets("AKIAIOSFODNN7EXAMPLE in code")).toBe("AKIA***EXAMPLE in code");
  });

  it("redacts Bearer tokens in headers", () => {
    expect(scrubSecrets("Authorization: Bearer eyJabcXYZ.long.token")).toBe(
      "Authorization: Bearer ***",
    );
  });

  it("redacts generic key:/password: yaml lines", () => {
    expect(scrubSecrets("password: hunter2")).toBe("password: ***");
    expect(scrubSecrets("api_key: abc123def")).toBe("api_key: ***");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubSecrets("the quick brown fox")).toBe("the quick brown fox");
    expect(scrubSecrets("git status")).toBe("git status");
  });

  it("redacts multiple matches in one string", () => {
    const input = "key=sk-ant-api03-XXXXXXXXXXXXXXXXXXXX and Bearer eyJ.abc.def";
    const output = scrubSecrets(input);
    expect(output).toContain("sk-ant-***");
    expect(output).toContain("Bearer ***");
  });
});
