import type { FaceAsset, PointSet } from "./asset.js";

/**
 * Per-dot attributes for the face renderer. Each dot learns which part of the
 * face it belongs to from the 478 landmarks: eyelids (blink), irises (gaze),
 * jaw and lips (speech), mouth corners (smile), brows, and whether it moves
 * with the head. Region maths runs in source-normalised units, the same space
 * the landmarks were measured in; positions are then mapped to face space
 * (x right, y up, centred on the crop, 1 unit = half the crop height).
 *
 * Phase F replaces these per-region offsets with a smooth deformation field.
 */

export const FLOATS = 14;
export type BuiltPoints = { data: Float32Array; count: number };

const JAW_IDS = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397];
const BROW_IDS = [[70, 63, 105, 66, 107], [336, 296, 334, 293, 300]];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function distSeg(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

type Eye = { cx: number; cy: number; rx: number; ry: number; ix: number; iy: number; ir: number; top: number };

export function buildPoints(asset: FaceAsset, which: "stipple" | "glow", limit: number): BuiltPoints {
  const { crop, landmarks, depth, depthSize, depthFit } = asset;
  const set: PointSet = which === "stipple" ? asset.stipple : asset.glow;
  const count = Math.max(0, Math.min(limit, set.count));

  // Crop-local → source-normalised.
  const sx = (u: number) => crop.cx - crop.halfX + u * 2 * crop.halfX;
  const sy = (v: number) => crop.cy - crop.halfY + v * 2 * crop.halfY;
  const L = (i: number): [number, number] => [sx(landmarks[i * 3]!), sy(landmarks[i * 3 + 1]!)];
  const K = 1 / crop.halfY;

  const eyeOf = (up: number, low: number, a: number, b: number, iris: number, edge: number): Eye => {
    const [, uy] = L(up), [, ly] = L(low), [ax] = L(a), [bx] = L(b), [ix, iy] = L(iris), [ex, ey] = L(edge);
    return { cx: (ax + bx) / 2, cy: (uy + ly) / 2, rx: Math.abs(bx - ax) * 0.68, ry: Math.max(0.028, (ly - uy) * 1.9), ix, iy, ir: Math.hypot(ex - ix, ey - iy) * 0.95, top: uy };
  };
  const eyes = [eyeOf(159, 145, 33, 133, 468, 469), eyeOf(386, 374, 362, 263, 473, 474)];
  const brows = BROW_IDS.map((ids) => ids.map(L));
  const jaw = JAW_IDS.map(L).sort((p, q) => p[0] - q[0]);
  const mouthL = L(61), mouthR = L(291), lipTop = L(0), inner = L(13);
  const mouthCx = inner[0];
  const chinY = L(152)[1];

  const jawY = (x: number) => {
    for (let i = 0; i < jaw.length - 1; i++) {
      const [ax, ay] = jaw[i]!, [bx, by] = jaw[i + 1]!;
      if (x >= ax && x <= bx) return ay + ((x - ax) / (bx - ax || 1)) * (by - ay);
    }
    return -1;
  };
  const depthZ = (u: number, v: number) => {
    const x = Math.min(depthSize - 1.001, Math.max(0, u * depthSize - 0.5));
    const y = Math.min(depthSize - 1.001, Math.max(0, v * depthSize - 0.5));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const at = (xx: number, yy: number) => depth[yy * depthSize + xx]!;
    const d = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    return Math.min(0.34, Math.max(-0.16, depthFit.a * d + depthFit.b));
  };

  const out = new Float32Array(count * FLOATS);
  for (let n = 0; n < count; n++) {
    const cu = set.u(n), cv = set.v(n), tone = set.tone(n);
    const u = sx(cu), v = sy(cv);
    const z = depthZ(cu, cv);

    let blink = 0, iris = 0;
    for (const eye of eyes) {
      const ex = (u - eye.cx) / eye.rx, ey = (v - eye.cy) / eye.ry, r2 = ex * ex + ey * ey;
      if (r2 < 1) { const w = 1 - r2; blink = (eye.cy + (eye.top - eye.cy) * -0.15 - v) * (v < eye.cy ? w : w * 0.45); }
      const di = Math.hypot(u - eye.ix, v - eye.iy);
      if (di < eye.ir) iris = 1 - smooth(eye.ir * 0.65, eye.ir, di);
    }

    let jawW = 0, lip = 0;
    const jy = jawY(u);
    const mouthLine = inner[1] + 0.004;
    if (jy > 0 && v > mouthLine && v < jy + 0.03) {
      const hx = 1 - smooth(0.07, 0.16, Math.abs(u - mouthCx));
      jawW = hx * (1 - smooth(jy - 0.005, jy + 0.03, v)) * (0.55 + 0.45 * smooth(mouthLine, mouthLine + 0.03, v));
    }
    if (v > lipTop[1] - 0.012 && v <= mouthLine && Math.abs(u - mouthCx) < 0.075) lip = 1 - smooth(0.04, 0.075, Math.abs(u - mouthCx));

    let smileX = 0, smileY = 0;
    for (const [side, corner] of [[-1, mouthL], [1, mouthR]] as const) {
      const dc = Math.hypot(u - corner[0], v - corner[1]);
      if (dc < 0.045) { const w = 1 - smooth(0.01, 0.045, dc); smileX += side * 0.011 * w; smileY += 0.012 * w; }
    }

    let brow = 0;
    for (const line of brows) {
      let dm = Infinity;
      for (let s = 0; s < line.length - 1; s++) dm = Math.min(dm, distSeg(u, v, line[s]!, line[s + 1]!));
      if (dm < 0.035) brow = Math.max(brow, 1 - smooth(0.012, 0.035, dm));
    }

    const head = 1 - smooth(chinY + 0.01, chinY + 0.11, v);
    const fade = 1 - smooth(0.86, 0.99, cv);
    const o = n * FLOATS;
    out[o] = (u - crop.cx) * K;
    out[o + 1] = -(v - crop.cy) * K;
    out[o + 2] = -z * K * 0.7;
    out[o + 3] = which === "glow" ? tone : 0.2 + 0.8 * (1 - tone);
    out[o + 4] = ((n * 2654435761) >>> 0) / 4294967296; // stable per-dot shimmer phase
    out[o + 5] = -blink * K;
    out[o + 6] = jawW;
    out[o + 7] = lip;
    out[o + 8] = iris;
    out[o + 9] = brow;
    out[o + 10] = smileX * K;
    out[o + 11] = smileY * K;
    out[o + 12] = head;
    out[o + 13] = fade;
  }
  return { data: out, count };
}
