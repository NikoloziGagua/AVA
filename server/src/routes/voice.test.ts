import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { voiceRoutes } from "./voice.js";
import type { VoiceClients } from "../tools/voice-clients.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";
import { DEFAULT_SPEECH_RATE } from "../voice/voiceConfig.js";

// Voices the OpenAI speech model exposes that read as female. Used to prove the
// no-saved-preference default speaks with a female voice.
const FEMALE_VOICES = new Set(["nova", "shimmer", "coral", "sage", "fable"]);

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
    expect(arg.voice).toBe(DEFAULT_VOICE);
  });

  it("defaults to a female voice when no preference is saved", async () => {
    const speak = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const app = setup(mockClients({ speak }));
    await request(app).post("/api/speak").send({ text: "hello" }).expect(200);
    const arg = speak.mock.calls[0]?.[0] as { voice: string };
    expect(arg.voice).toBe(DEFAULT_VOICE);
    expect(FEMALE_VOICES.has(arg.voice)).toBe(true);
  });

  it("keeps the faster speech preference unchanged for the default delivery", async () => {
    const speak = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const app = setup(mockClients({ speak }));
    await request(app).post("/api/speak").send({ text: "hello" }).expect(200);
    const arg = speak.mock.calls[0]?.[0] as { speed: number };
    expect(arg.speed).toBe(DEFAULT_SPEECH_RATE);
    expect(arg.speed).toBeGreaterThan(1.0);
  });

  it("delivers \"Sir\" seamlessly — no comma/break/pause around the vocative", async () => {
    const speak = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const app = setup(mockClients({ speak }));
    await request(app).post("/api/speak").send({ text: "Yes, Sir, right away." }).expect(200);
    const arg = speak.mock.calls[0]?.[0] as { input: string };
    // The synthesized text drops the commas hugging the vocative so the engine
    // reads "Yes Sir ..." without a stutter — and adds no SSML break/pause.
    expect(arg.input).toBe("Yes Sir right away.");
    expect(arg.input).not.toMatch(/,\s*Sir|Sir\s*,/);
    expect(arg.input).not.toMatch(/<break|pause/i);
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

describe("voiceRoutes exposes NO toolless conversation endpoint", () => {
  // Regression guard: the old /api/voice/turn ran a conversation-only, toolless
  // model. It was deleted so voice can never silently diverge from the
  // tool-using /api/chat agent. If someone re-adds a reply endpoint here, this
  // fails and forces them to reconsider.
  it("does not register /api/voice/turn", async () => {
    const app = setup(mockClients({}));
    const res = await request(app)
      .post("/api/voice/turn")
      .attach("audio", Buffer.from([0, 1, 2]), { filename: "x.webm", contentType: "audio/webm" });
    expect(res.status).toBe(404);
  });
});
