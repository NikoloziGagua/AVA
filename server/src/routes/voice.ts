import { Router, type Router as ExpressRouter, type RequestHandler } from "express";
import multer from "multer";
import { toFile } from "openai";
import type { VoiceClients } from "../tools/voice-clients.js";
import type { Db } from "../state/db.js";
import { formatSpeechText } from "../voice/speechText.js";
import { resolveSpeechRate } from "../voice/voiceConfig.js";
import { chatterboxSpeak, chatterboxUrl } from "../voice/chatterbox.js";
import { getVoiceEngine } from "../state/voice-engine-pref.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";

const ALLOWED_MIMES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
]);

export type VoiceRoutesDeps = {
  clients: VoiceClients;
  requireToken: RequestHandler;
  /** Used to read the global voice-engine preference per request. */
  db: Db;
  /** Optional structured logger (warns when Chatterbox falls back to OpenAI). */
  log?: { warn: (...a: unknown[]) => void };
};

export function voiceRoutes(deps: VoiceRoutesDeps): ExpressRouter {
  const router: ExpressRouter = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  router.post("/transcribe", deps.requireToken, upload.single("audio"), async (req, res) => {
    if (!deps.clients) {
      return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "missing audio file" });
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return res.status(400).json({ error: `unsupported audio mime: ${file.mimetype}` });
    }
    try {
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      const filename = file.originalname || "audio.webm";
      const f = await toFile(blob, filename, { type: file.mimetype });
      const r = await deps.clients.openai.audio.transcriptions.create({
        file: f,
        model: "gpt-4o-transcribe",
      });
      return res.json({ text: r.text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: `transcribe failed: ${msg}` });
    }
  });

  // Synthesize via OpenAI gpt-4o-mini-tts → mpeg bytes. Used by the "openai"
  // engine and as the resilience fallback when Chatterbox is unavailable.
  // Returns null if no OpenAI client is configured.
  async function speakOpenAi(text: string, voice: string, speed: unknown): Promise<Buffer | null> {
    if (!deps.clients) return null;
    // Smooth vocative "Sir" punctuation only for what is synthesized — the
    // persisted/displayed text the client sent is unaffected.
    const r = await deps.clients.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice as "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse",
      input: formatSpeechText(text),
      // Faster default delivery per Sir's preference; a caller may override.
      speed: resolveSpeechRate(speed),
    });
    return Buffer.from(await r.arrayBuffer());
  }

  router.post("/speak", deps.requireToken, async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const voice = typeof req.body?.voice === "string" ? req.body.voice : DEFAULT_VOICE;
    if (!text.trim()) return res.status(400).json({ error: "text required" });

    const engine = getVoiceEngine(deps.db);

    // engine="openai" (default): UNCHANGED — OpenAI gpt-4o-mini-tts.
    if (engine === "openai") {
      if (!deps.clients) {
        return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
      }
      try {
        const buf = await speakOpenAi(text, voice, req.body?.speed);
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(buf!);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `tts failed: ${msg}` });
      }
    }

    // engine="chatterbox" | "hybrid": synthesize via the LOCAL Chatterbox server
    // so Ava's narrated/spoken /api/speak output is the cloned voice. Same "Sir"
    // smoothing is applied so the spoken form doesn't stutter on the vocative.
    try {
      const buf = await chatterboxSpeak(formatSpeechText(text));
      res.setHeader("Content-Type", "audio/wav");
      return res.send(buf);
    } catch (err) {
      // RESILIENCE: Chatterbox is down / errored / timed out. Fall back to OpenAI
      // (if configured) so voice never fully breaks; otherwise 502.
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.warn(`/api/speak: Chatterbox TTS failed (${chatterboxUrl()}): ${msg} — falling back to OpenAI`);
      if (!deps.clients) {
        return res.status(502).json({ error: `chatterbox tts failed: ${msg}` });
      }
      try {
        const buf = await speakOpenAi(text, voice, req.body?.speed);
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(buf!);
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        return res.status(502).json({ error: `tts failed: ${msg2}` });
      }
    }
  });

  // NOTE: there is intentionally no agent/conversation endpoint here. Voice
  // turns route through the SAME tool-using agent as typed chat: the realtime
  // WS proxy (routes/voice-realtime.ts) gates transcripts and the browser
  // submits accepted text to POST /api/chat. These routes are STT/TTS
  // primitives only — they never generate a conversational reply, so there is
  // no toolless voice path to drift out of sync with text chat.

  return router;
}
