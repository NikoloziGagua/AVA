import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { voiceRoutes } from "./voice.js";
import type { VoiceClients } from "../tools/voice-clients.js";

function setup(clients: VoiceClients) {
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api", voiceRoutes({ clients, requireToken: auth }));
  return app;
}

function mockClients(overrides: {
  transcribe?: ReturnType<typeof vi.fn>;
  speak?: ReturnType<typeof vi.fn>;
}): VoiceClients {
  const transcribe = overrides.transcribe ?? vi.fn().mockResolvedValue({ text: "hello" });
  const speak =
    overrides.speak ??
    vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  return {
    openai: {
      audio: {
        transcriptions: { create: transcribe },
        speech: { create: speak },
      },
    },
  } as unknown as VoiceClients;
}

describe("voiceRoutes /api/transcribe", () => {
  it("returns 503 when clients are null", async () => {
    const app = setup(null);
    const res = await request(app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from([0, 1, 2]), { filename: "a.webm", contentType: "audio/webm" });
    expect(res.status).toBe(503);
  });

  it("returns 200 with text on success", async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: "hello" });
    const app = setup(mockClients({ transcribe }));
    const res = await request(app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from([0, 1, 2, 3]), { filename: "a.webm", contentType: "audio/webm" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "hello" });
    expect(transcribe).toHaveBeenCalledOnce();
    const arg = transcribe.mock.calls[0]?.[0] as { model: string };
    expect(arg.model).toBe("gpt-4o-transcribe");
  });

  it("returns 400 for unsupported mime", async () => {
    const app = setup(mockClients({}));
    const res = await request(app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from([0, 1, 2]), { filename: "a.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported audio mime/);
  });

  it("returns 400 when audio file is missing", async () => {
    const app = setup(mockClients({}));
    const res = await request(app).post("/api/transcribe");
    expect(res.status).toBe(400);
  });
});

describe("voiceRoutes /api/speak", () => {
  it("returns 503 when clients are null", async () => {
    const app = setup(null);
    const res = await request(app).post("/api/speak").send({ text: "hi" });
    expect(res.status).toBe(503);
  });

  it("returns 200 audio/mpeg with bytes on success", async () => {
    const speak = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([10, 20, 30, 40]).buffer,
    });
    const app = setup(mockClients({ speak }));
    const res = await request(app).post("/api/speak").send({ text: "hello world" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(Array.from(res.body as Buffer)).toEqual([10, 20, 30, 40]);
    expect(speak).toHaveBeenCalledOnce();
    const arg = speak.mock.calls[0]?.[0] as { model: string; input: string; voice: string };
    expect(arg.model).toBe("gpt-4o-mini-tts");
    expect(arg.input).toBe("hello world");
    expect(arg.voice).toBe("nova");
  });

  it("uses provided voice when given", async () => {
    const speak = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const app = setup(mockClients({ speak }));
    await request(app).post("/api/speak").send({ text: "x", voice: "nova" }).expect(200);
    const arg = speak.mock.calls[0]?.[0] as { voice: string };
    expect(arg.voice).toBe("nova");
  });

  it("returns 400 when text is missing/empty", async () => {
    const app = setup(mockClients({}));
    await request(app).post("/api/speak").send({}).expect(400);
    await request(app).post("/api/speak").send({ text: "   " }).expect(400);
  });
});
