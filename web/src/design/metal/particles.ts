/** Bounded, deterministic particle field. No browser or rendering dependencies. */
export type Star = { x: number; y: number; z: number; size: number };
export const STAR_COUNT = 900;

export function createStars(count = STAR_COUNT): Star[] {
  let seed = 27391;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const length = Math.max(0, Math.min(STAR_COUNT, Math.floor(Number.isFinite(count) ? count : 0)));
  return Array.from({ length }, () => ({
    x: (random() - 0.5) * 2.4,
    y: (random() - 0.5) * 2.4,
    z: 0.1 + random() * 1.9,
    size: 0.5 + random() * 0.8,
  }));
}

export function advanceStars(stars: Star[], deltaSeconds: number): void {
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.05, deltaSeconds)) : 0;
  for (const star of stars) {
    star.z -= dt * 0.5;
    if (star.z < 0.1) star.z += 1.9;
  }
}

export function projectStar(star: Star, width: number, height: number) {
  const scale = Math.max(width, height) * 0.55;
  const x = width * 0.5 + star.x * scale / star.z;
  const y = height * 0.48 + star.y * scale / star.z;
  return {
    x, y,
    radius: Math.min(2.1, star.size / star.z),
    opacity: Math.min(0.75, 0.16 + (2.1 - star.z) * 0.32),
    visible: x >= -3 && y >= -3 && x <= width + 3 && y <= height + 3,
  };
}
