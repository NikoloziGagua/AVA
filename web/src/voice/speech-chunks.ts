// Sentence-chunking for the TTS speak queue. A monolithic task result used to
// ride ONE /api/speak clip — 2-3s of synthesis dead air before any audio.
// Splitting at sentence boundaries lets the first sentence play while the rest
// synthesize (the speak worker prefetches clip N+1 during clip N). Pure + tested.

const DEFAULT_MAX = 200;

// Common abbreviations whose trailing dot does NOT end a sentence. Deliberately
// short — ambiguous words ("no", "st" as "street") are left out so a real
// sentence end is never swallowed. Titles match case-SENSITIVELY: "Ms." the
// title is an abbreviation, "0.5 ms." the unit ends its sentence.
const TITLE_ABBREVIATIONS = new Set(["Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr"]);
const LOWER_ABBREVIATIONS = new Set(["vs", "etc", "e.g", "i.e", "eg", "ie", "fig", "approx"]);

function endsWithAbbreviation(before: string): boolean {
  const m = /([A-Za-z][A-Za-z.]*)$/.exec(before);
  if (!m) return false;
  return TITLE_ABBREVIATIONS.has(m[1]!) || LOWER_ABBREVIATIONS.has(m[1]!.toLowerCase());
}

/**
 * Split text into sentences. A boundary is sentence punctuation (plus optional
 * closing quotes/brackets) followed by whitespace — so a decimal point ("0.5")
 * never splits (no whitespace after the dot), and a known abbreviation's dot
 * is skipped.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]+["')\]]*\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith(".") && endsWithAbbreviation(text.slice(start, m.index))) continue;
    const end = m.index + m[0].length;
    const s = text.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Last-resort split for a single overlong sentence: clause marks, else words. */
function hardSplit(s: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    const space = window.lastIndexOf(" ");
    const at = clause > 40 ? clause + 1 : space > 40 ? space : maxLen;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chunk `text` for the speak queue. Texts within `maxLen` stay whole (one clip,
 * fewer TTS round-trips). Longer texts split at sentence boundaries: the FIRST
 * sentence rides alone (fastest first audio), subsequent sentences pack
 * greedily into ~≤maxLen chunks.
 */
export function splitForSpeech(text: string, maxLen = DEFAULT_MAX): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];

  const pieces = splitSentences(t).flatMap((s) => (s.length > maxLen ? hardSplit(s, maxLen) : [s]));
  const chunks: string[] = [];
  for (const p of pieces) {
    const last = chunks[chunks.length - 1];
    if (chunks.length > 1 && last && last.length + 1 + p.length <= maxLen) {
      chunks[chunks.length - 1] = `${last} ${p}`;
    } else {
      chunks.push(p);
    }
  }
  return chunks;
}
