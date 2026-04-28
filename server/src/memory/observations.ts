export type Confidence = "low" | "medium" | "high";

export type Observation = {
  date: string;
  confidence: Confidence;
  category: string;
  text: string;
  superseded: string | null;
};

const ACTIVE_RE =
  /^- \[(\d{4}-\d{2}-\d{2}) \/ (low|medium|high) \/ ([^/\]]+?)\] (.+)$/;
const SUPERSEDED_RE =
  /^- \[(\d{4}-\d{2}-\d{2}) \/ (low|medium|high) \/ ([^/\]]+?) \/ superseded (\d{4}-\d{2}-\d{2})\] (.+)$/;

export function parseObservation(line: string): Observation | null {
  const sm = SUPERSEDED_RE.exec(line);
  if (sm) {
    return {
      date: sm[1]!, confidence: sm[2]! as Confidence, category: sm[3]!.trim(),
      text: sm[5]!, superseded: sm[4]!,
    };
  }
  const am = ACTIVE_RE.exec(line);
  if (am) {
    return {
      date: am[1]!, confidence: am[2]! as Confidence, category: am[3]!.trim(),
      text: am[4]!, superseded: null,
    };
  }
  return null;
}

export function serializeObservation(o: Observation): string {
  const meta = o.superseded
    ? `${o.date} / ${o.confidence} / ${o.category} / superseded ${o.superseded}`
    : `${o.date} / ${o.confidence} / ${o.category}`;
  return `- [${meta}] ${o.text}`;
}

export function bumpConfidence(c: Confidence): Confidence {
  if (c === "low") return "medium";
  if (c === "medium") return "high";
  return "high";
}

export type RefreshResult = { content: string; changed: boolean };

export function applyRefresh(
  fileContent: string,
  opts: { match: string; today: string },
): RefreshResult {
  const lines = fileContent.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const obs = parseObservation(lines[i]!);
    if (!obs || obs.superseded) continue;
    if (!obs.text.includes(opts.match)) continue;
    obs.confidence = bumpConfidence(obs.confidence);
    obs.date = opts.today;
    lines[i] = serializeObservation(obs);
    changed = true;
    break;
  }
  return { content: lines.join("\n"), changed };
}

export function applySupersede(
  fileContent: string,
  opts: { match: string; today: string },
): RefreshResult {
  const lines = fileContent.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const obs = parseObservation(lines[i]!);
    if (!obs || obs.superseded) continue;
    if (!obs.text.includes(opts.match)) continue;
    obs.superseded = opts.today;
    lines[i] = serializeObservation(obs);
    changed = true;
    break;
  }
  return { content: lines.join("\n"), changed };
}
