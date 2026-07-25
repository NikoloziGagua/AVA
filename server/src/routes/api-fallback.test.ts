import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { apiNotFound } from "./api-fallback.js";

describe("API fallback", () => {
  it("returns actionable JSON instead of Express HTML for an unknown API route", async () => {
    const app = express();
    app.use("/api", apiNotFound());
    const response = await request(app)
      .get("/api/explorer/not-present")
      .expect(404)
      .expect("content-type", /json/);
    expect(response.body).toMatchObject({
      error: "api_route_not_found",
      retryable: false,
    });
    expect(response.body.action).toContain("restart");
    expect(response.text).not.toContain("<!DOCTYPE");
  });
});
