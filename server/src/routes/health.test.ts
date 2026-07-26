import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { healthRoutes } from "./health.js";

describe("healthRoutes", () => {
  it("reports a live but unready server when no provider is configured", async () => {
    const app = express();
    app.use("/api", healthRoutes(Date.now(), { provider: null }));

    const res = await request(app).get("/api/health").expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      ready: false,
      provider: null,
      issues: ["no_llm_provider"],
    });
  });

  it("reports ready with the selected provider", async () => {
    const app = express();
    app.use("/api", healthRoutes(Date.now(), { provider: "openai" }));

    const res = await request(app).get("/api/health").expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      ready: true,
      provider: "openai",
      issues: [],
    });
  });
});
