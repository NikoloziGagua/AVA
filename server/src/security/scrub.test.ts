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

  it("redacts OpenAI project keys (sk-proj-…) which the old rule missed", () => {
    const out = scrubSecrets("OPENAI_API_KEY=sk-proj-AbCdEf0123456789AbCdEf0123456789");
    expect(out).not.toContain("AbCdEf0123456789");
    expect(out).toContain("sk-***");
  });

  it("redacts GitHub personal access tokens (ghp_/gho_/ghu_/ghs_/ghr_)", () => {
    for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      const token = `${prefix}_${"A1b2C3d4E5".repeat(4)}`; // 40 chars after prefix
      const out = scrubSecrets(`token=${token}`);
      expect(out).not.toContain(token);
      expect(out).toContain("***");
    }
  });

  it("redacts GitHub fine-grained PATs (github_pat_…)", () => {
    const token = `github_pat_${"A1b2C3d4E5".repeat(5)}`;
    const out = scrubSecrets(`GH=${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain("***");
  });

  it("redacts Google API keys (AIza…)", () => {
    const key = "AIzaSyA1234567890abcdefghijklmnopqrstuvw"; // AIza + 35
    const out = scrubSecrets(`GOOGLE_API_KEY=${key}`);
    expect(out).not.toContain(key);
    expect(out).toContain("***");
  });

  it("redacts Slack tokens (xoxb-/xoxa-/xoxp-/xoxr-/xoxs-)", () => {
    for (const prefix of ["xoxb", "xoxa", "xoxp", "xoxr", "xoxs"]) {
      const token = `${prefix}-1234567890-ABCDEFGHIJ`;
      const out = scrubSecrets(`SLACK=${token}`);
      expect(out).not.toContain(token);
      expect(out).toContain("***");
    }
  });

  it("redacts JWTs (eyJ…)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = scrubSecrets(`Cookie: jwt=${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("***");
  });

  it("redacts PEM private key headers", () => {
    const out = scrubSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out).toContain("***");
  });

  it("redacts database/broker connection strings with credentials", () => {
    for (const url of [
      "postgres://user:pass@host:5432/db",
      "postgresql://user:secret@host/db",
      "mysql://root:hunter2@127.0.0.1/app",
      "mongodb://admin:pw@cluster0/db",
      "mongodb+srv://admin:pw@cluster0.mongodb.net/db",
      "redis://default:token@redis:6379",
      "amqp://guest:guest@rabbit:5672",
    ]) {
      const out = scrubSecrets(`DB_URL=${url}`);
      expect(out).not.toMatch(/:(pass|secret|hunter2|pw|token|guest)@/);
      expect(out).toContain("***");
    }
  });

  it("redacts Stripe secret keys (sk_live_/sk_test_)", () => {
    for (const key of [
      "sk_live_" + "A1b2C3d4E5".repeat(3),
      "sk_test_" + "A1b2C3d4E5".repeat(3),
    ]) {
      const out = scrubSecrets(`STRIPE=${key}`);
      expect(out).not.toContain(key);
      expect(out).toContain("***");
    }
  });

  it("redacts Anthropic OAuth tokens (sk-ant-oat../sk-ant-ort..)", () => {
    for (const key of [
      "sk-ant-oat01-" + "A1b2C3d4E5".repeat(3),
      "sk-ant-ort01-" + "A1b2C3d4E5".repeat(3),
    ]) {
      const out = scrubSecrets(`AUTH=${key}`);
      expect(out).not.toContain(key);
      expect(out).toContain("sk-ant-***");
    }
  });

  it("redacts Figma tokens (figu_/figur_/figud_)", () => {
    for (const key of [
      "figu_" + "A1b2C3d4E5_-".repeat(2),
      "figur_" + "A1b2C3d4E5_-".repeat(2),
      "figud_" + "A1b2C3d4E5_-".repeat(2),
    ]) {
      const out = scrubSecrets(`FIGMA=${key}`);
      expect(out).not.toContain(key);
      expect(out).toContain("***");
    }
  });

  it("redacts Supabase service keys (sba_…)", () => {
    const key = "sba_" + "A1b2C3d4E5".repeat(3);
    const out = scrubSecrets(`SUPABASE=${key}`);
    expect(out).not.toContain(key);
    expect(out).toContain("***");
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
