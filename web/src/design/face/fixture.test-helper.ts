import { expectedLength, HEADER_BYTES, LANDMARK_COUNT, POINT_BYTES } from "./asset.js";

export type FixtureOptions = {
  stipple?: number;
  glow?: number;
  depthSize?: number;
  crop?: [number, number, number, number];
  fit?: [number, number];
  seed?: number;
};

/**
 * A small, valid face asset built in memory for tests (face-asset v1 §3).
 * Points form a soft oval so the renderer has something face-shaped; the
 * landmarks follow MediaPipe's index layout closely enough for region weights.
 */
export function buildFaceAsset(options: FixtureOptions = {}): ArrayBuffer {
  const stipple = options.stipple ?? 400;
  const glow = options.glow ?? 300;
  const depthSize = options.depthSize ?? 16;
  const [cx, cy, halfX, halfY] = options.crop ?? [0.5, 0.5, 0.4, 0.4];
  const [a, b] = options.fit ?? [-0.0025, 0.5];
  const total = expectedLength(stipple, glow, LANDMARK_COUNT, depthSize);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  "AVAF".split("").forEach((char, i) => view.setUint8(i, char.charCodeAt(0)));
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, stipple, true);
  view.setUint32(12, glow, true);
  view.setUint32(16, LANDMARK_COUNT, true);
  view.setUint16(20, depthSize, true);
  view.setFloat32(24, cx, true);
  view.setFloat32(28, cy, true);
  view.setFloat32(32, halfX, true);
  view.setFloat32(36, halfY, true);
  view.setFloat32(40, a, true);
  view.setFloat32(44, b, true);
  view.setUint32(48, options.seed ?? 7, true);

  let at = HEADER_BYTES;
  const writePoints = (count: number, salt: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (i * 2.399963 + salt) % (Math.PI * 2);
      const radius = Math.sqrt(((i * 0.618034 + salt) % 1));
      view.setUint16(at, Math.round((0.5 + Math.cos(angle) * radius * 0.35) * 65535), true);
      view.setUint16(at + 2, Math.round((0.5 + Math.sin(angle) * radius * 0.45) * 65535), true);
      view.setUint8(at + 4, Math.round(80 + 150 * (1 - radius)));
      at += POINT_BYTES;
    }
  };
  writePoints(stipple, 0.1);
  writePoints(glow, 0.7);
  at += (4 - (at % 4)) % 4;
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const angle = (i / LANDMARK_COUNT) * Math.PI * 2;
    view.setFloat32(at, 0.5 + Math.cos(angle) * 0.3, true);
    view.setFloat32(at + 4, 0.5 + Math.sin(angle) * 0.4, true);
    view.setFloat32(at + 8, 0.05 * Math.cos(angle * 3), true);
    at += 12;
  }
  for (let i = 0; i < depthSize * depthSize; i++) view.setUint8(at + i, (i * 37) % 256);
  return buffer;
}
