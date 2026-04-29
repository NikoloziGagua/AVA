import {
  parseObservation,
  serializeObservation,
  bumpConfidence,
} from "./observations.js";

export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PromoteResult =
  | { kind: "promoted"; content: string }
  | { kind: "appended"; content: string };

export function promoteOnRepeat(
  existingContent: string,
  newLine: string,
  today: string,
): PromoteResult {
  const incoming = parseObservation(newLine);
  if (!incoming || incoming.superseded) {
    return appendToContent(existingContent, newLine);
  }
  const incomingKey = normalizeForCompare(incoming.text);
  const lines = existingContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const obs = parseObservation(lines[i]!);
    if (!obs || obs.superseded) continue;
    if (obs.category !== incoming.category) continue;
    if (normalizeForCompare(obs.text) !== incomingKey) continue;
    obs.confidence = bumpConfidence(obs.confidence);
    obs.date = today;
    lines[i] = serializeObservation(obs);
    return { kind: "promoted", content: lines.join("\n") };
  }
  return appendToContent(existingContent, newLine);
}

function appendToContent(existing: string, line: string): PromoteResult {
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return { kind: "appended", content: existing + sep + line + "\n" };
}
