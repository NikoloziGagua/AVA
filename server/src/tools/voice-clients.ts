import OpenAI from "openai";

export type VoiceClients = { openai: OpenAI } | null;

export function buildVoiceClients(opts: { apiKey: string | null }): VoiceClients {
  if (!opts.apiKey) return null;
  return { openai: new OpenAI({ apiKey: opts.apiKey }) };
}
