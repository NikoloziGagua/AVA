/** Face colours come from the look's tokens (--ds-face-dot, --ds-face-light), never literals. */

export type Rgb = [number, number, number];

const FALLBACK: Record<"dot" | "light", Rgb> = { dot: [0.84, 0.86, 0.96], light: [1, 1, 1] };

function parseColour(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
  if (fn) return [Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255];
  return null;
}

/** Reads the current look's face colours as 0..1 RGB, plus the CSS strings for 2D canvas. */
export function faceColours(root: HTMLElement = document.documentElement): { dot: Rgb; light: Rgb; dotCss: string } {
  const style = getComputedStyle(root);
  const dotCss = style.getPropertyValue("--ds-face-dot").trim();
  const lightCss = style.getPropertyValue("--ds-face-light").trim();
  return {
    dot: parseColour(dotCss) ?? FALLBACK.dot,
    light: parseColour(lightCss) ?? FALLBACK.light,
    dotCss: dotCss || "currentColor",
  };
}
