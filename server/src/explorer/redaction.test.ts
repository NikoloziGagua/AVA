import { describe, expect, it } from "vitest";
import {
  sanitiseExplorerText,
  sanitiseExplorerValue,
} from "./redaction.js";

describe("Explorer auth and cookie redaction", () => {
  it("redacts sensitive headers at any object depth while preserving safe evidence", () => {
    const input = {
      status: 200,
      headers: {
        "content-type": "application/json",
        Authorization: "Basic dXNlcjpwYXNz",
        Cookie: "session=raw-cookie; csrf=raw-csrf",
        "Set-Cookie": ["session=set-cookie", "theme=dark"],
        "Proxy-Authorization": "Bearer proxy-secret",
        "X-API-Key": "raw-api-key",
      },
      nested: {
        request: {
          headers: {
            authorization: "Bearer nested-secret",
            accept: "application/json",
          },
        },
      },
    };

    const safe = sanitiseExplorerValue(input) as typeof input;
    expect(safe.status).toBe(200);
    expect(safe.headers["content-type"]).toBe("application/json");
    expect(safe.headers.Authorization).toBe("***");
    expect(safe.headers.Cookie).toBe("***");
    expect(safe.headers["Set-Cookie"]).toBe("***");
    expect(safe.headers["Proxy-Authorization"]).toBe("***");
    expect(safe.headers["X-API-Key"]).toBe("***");
    expect(safe.nested.request.headers.authorization).toBe("***");
    expect(safe.nested.request.headers.accept).toBe("application/json");
    expect(JSON.stringify(safe)).not.toMatch(
      /dXNlcjpwYXNz|raw-cookie|raw-csrf|set-cookie|proxy-secret|raw-api-key|nested-secret/,
    );
  });

  it("redacts tuple-form headers and JSON encoded inside arbitrary tool output", () => {
    const tupleHeaders = [
      ["content-type", "text/plain"],
      ["authorization", "Basic tuple-secret"],
      ["cookie", "sid=tuple-cookie"],
    ];
    const safeTuples = sanitiseExplorerValue(tupleHeaders);
    expect(safeTuples).toEqual([
      ["content-type", "text/plain"],
      ["authorization", "***"],
      ["cookie", "***"],
    ]);

    const jsonOutput = JSON.stringify({
      ok: false,
      headers: {
        authorization: "Basic json-secret",
        cookie: "sid=json-cookie",
        "set-cookie": ["sid=json-set-cookie"],
        "x-api-key": "json-key",
        "content-type": "application/problem+json",
      },
      message: "upstream returned 401",
    });
    const safeJson = sanitiseExplorerText(jsonOutput)!;
    expect(safeJson).not.toMatch(/json-secret|json-cookie|json-set-cookie|json-key/);
    expect(safeJson).toContain("application/problem+json");
    expect(safeJson).toContain("upstream returned 401");
  });

  it("redacts raw HTTP and command output without discarding unrelated lines", () => {
    const raw = [
      "HTTP/1.1 401 Unauthorized",
      "Authorization: Basic cmF3OnNlY3JldA==",
      "Proxy-Authorization: Bearer raw-proxy-secret",
      "Cookie: session=raw-session; csrf=raw-csrf",
      "Set-Cookie: refresh=raw-refresh; HttpOnly; Secure",
      "X-API-Key: raw-header-key",
      "Content-Type: application/json",
      "body: permission denied",
    ].join("\r\n");

    const safe = sanitiseExplorerText(raw)!;
    expect(safe).not.toMatch(
      /cmF3OnNlY3JldA|raw-proxy-secret|raw-session|raw-csrf|raw-refresh|raw-header-key/,
    );
    expect(safe.match(/\*\*\*/g)?.length).toBe(5);
    expect(safe).toContain("HTTP/1.1 401 Unauthorized");
    expect(safe).toContain("Content-Type: application/json");
    expect(safe).toContain("body: permission denied");
  });

  it("redacts credentials embedded in shell flags, environment assignments and URL userinfo", () => {
    const command = [
      "OPENAI_API_KEY=env-secret curl",
      "--cookie 'sid=cli-cookie'",
      "--password hunter2",
      "-p short-secret",
      "-u alice:user-password",
      "https://bob:url-password@example.test/private",
      "--output response.json",
    ].join(" ");

    const safe = sanitiseExplorerText(command)!;
    for (const secret of [
      "env-secret",
      "cli-cookie",
      "hunter2",
      "short-secret",
      "alice:user-password",
      "bob:url-password",
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain("OPENAI_API_KEY=***");
    expect(safe).toContain("--cookie ***");
    expect(safe).toContain("--password ***");
    expect(safe).toContain("-p ***");
    expect(safe).toContain("-u ***");
    expect(safe).toContain("https://***:***@example.test/private");
    expect(safe).toContain("--output response.json");
  });

  it("removes complete and unterminated private-key blocks, including their bodies", () => {
    const complete = [
      "file: id_rsa",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==",
      "c3VwZXItc2VjcmV0LWtleS1ib2R5",
      "-----END OPENSSH PRIVATE KEY-----",
      "exit code: 0",
    ].join("\n");
    const incomplete = [
      "-----BEGIN EC PRIVATE KEY-----",
      "MHcCAQEEIOJ1c3QtYS1wcml2YXRlLWtleS1ib2R5",
    ].join("\n");

    const safeComplete = sanitiseExplorerText(complete)!;
    const safeIncomplete = sanitiseExplorerText(incomplete)!;
    expect(safeComplete).toContain("file: id_rsa");
    expect(safeComplete).toContain("exit code: 0");
    expect(safeComplete).toContain("[private key redacted]");
    expect(safeComplete).not.toMatch(/b3BlbnNzaC1|c3VwZXItc2VjcmV0/);
    expect(safeIncomplete).toBe("[private key redacted]");
    expect(safeIncomplete).not.toContain("MHcCAQ");
  });

  it("bounds very large structured output while retaining its useful prefix", () => {
    const input = Array.from({ length: 250 }, (_, index) => ({
      index,
      result: `evidence-${index}`,
    }));
    const safe = sanitiseExplorerValue(input) as unknown[];
    expect(safe).toHaveLength(201);
    expect(safe[0]).toEqual({ index: 0, result: "evidence-0" });
    expect(safe.at(-1)).toContain("50 more items");
    expect(JSON.stringify(safe)).not.toContain("evidence-249");
  });
});
