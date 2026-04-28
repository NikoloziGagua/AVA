import { Router, type Router as ExpressRouter, type RequestHandler } from "express";
import multer from "multer";
import { toFile } from "openai";
import type { VoiceClients } from "../tools/voice-clients.js";

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

export function voiceRoutes(deps: {
  clients: VoiceClients;
  requireToken: RequestHandler;
}): ExpressRouter {
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

  router.post("/speak", deps.requireToken, async (req, res) => {
    if (!deps.clients) {
      return res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    }
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const voice = typeof req.body?.voice === "string" ? req.body.voice : "alloy";
    if (!text.trim()) return res.status(400).json({ error: "text required" });
    try {
      const r = await deps.clients.openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: voice as "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "onyx" | "nova" | "sage" | "shimmer" | "verse",
        input: text,
      });
      res.setHeader("Content-Type", "audio/mpeg");
      const buf = Buffer.from(await r.arrayBuffer());
      return res.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: `tts failed: ${msg}` });
    }
  });

  return router;
}
