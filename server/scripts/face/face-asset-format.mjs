import { createHash } from "node:crypto";

export const FACE_ASSET_SCHEMA = 1;
export const HEADER_BYTES = 64;
export const LANDMARK_COUNT = 478;
export const POINT_RECORD_BYTES = 5;
export const LANDMARK_RECORD_BYTES = 12;

function invariant(condition, message) {
  if (!condition) throw new Error(`invalid AVA face asset: ${message}`);
}

function finite(value, label) {
  invariant(Number.isFinite(value), `${label} must be finite`);
}

export function expectedFaceAssetBytes({ stipple, glow, landmarks, depthSize }) {
  const pointsEnd = HEADER_BYTES + POINT_RECORD_BYTES * (stipple + glow);
  const padding = (4 - (pointsEnd % 4)) % 4;
  return pointsEnd + padding + LANDMARK_RECORD_BYTES * landmarks + depthSize * depthSize;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validatePointSet(points, name, maximum) {
  invariant(points && points.u && points.v && points.tone, `${name} is missing arrays`);
  const count = points.u.length;
  invariant(count >= 1 && count <= maximum, `${name} count is outside its allowed range`);
  invariant(points.v.length === count && points.tone.length === count, `${name} arrays differ in length`);
  for (let index = 0; index < count; index += 1) {
    const u = points.u[index];
    const v = points.v[index];
    const tone = points.tone[index];
    finite(u, `${name}[${index}].u`);
    finite(v, `${name}[${index}].v`);
    finite(tone, `${name}[${index}].tone`);
    invariant(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${name}[${index}] is outside the crop`);
    invariant(tone >= 0 && tone <= 255, `${name}[${index}].tone is outside 0..255`);
  }
  return count;
}

export function encodeFaceAsset({ stipple, glow, landmarks, depth, depthSize, crop, depthFit, seed }) {
  const stippleCount = validatePointSet(stipple, "stipple", 120_000);
  const glowCount = validatePointSet(glow, "glow", 80_000);
  invariant(Array.isArray(landmarks) && landmarks.length === LANDMARK_COUNT, "landmark count must be 478");
  invariant(Number.isInteger(depthSize) && depthSize >= 16 && depthSize <= 512, "depth size is invalid");
  invariant(depth instanceof Uint8Array && depth.length === depthSize * depthSize, "depth byte length is invalid");
  invariant(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff, "seed must be a uint32");
  for (const [key, value] of Object.entries(crop)) finite(value, `crop.${key}`);
  invariant(crop.halfX > 0 && crop.halfX <= 0.5 && crop.halfY > 0 && crop.halfY <= 0.5, "crop half extents are invalid");
  invariant(crop.cx - crop.halfX >= 0 && crop.cx + crop.halfX <= 1, "crop x extent leaves the source");
  invariant(crop.cy - crop.halfY >= 0 && crop.cy + crop.halfY <= 1, "crop y extent leaves the source");
  finite(depthFit.a, "depthFit.a");
  finite(depthFit.b, "depthFit.b");

  const bytes = expectedFaceAssetBytes({
    stipple: stippleCount,
    glow: glowCount,
    landmarks: landmarks.length,
    depthSize,
  });
  const buffer = Buffer.alloc(bytes);
  buffer.write("AVAF", 0, 4, "ascii");
  buffer.writeUInt16LE(FACE_ASSET_SCHEMA, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt32LE(stippleCount, 8);
  buffer.writeUInt32LE(glowCount, 12);
  buffer.writeUInt32LE(landmarks.length, 16);
  buffer.writeUInt16LE(depthSize, 20);
  buffer.writeUInt16LE(0, 22);
  buffer.writeFloatLE(crop.cx, 24);
  buffer.writeFloatLE(crop.cy, 28);
  buffer.writeFloatLE(crop.halfX, 32);
  buffer.writeFloatLE(crop.halfY, 36);
  buffer.writeFloatLE(depthFit.a, 40);
  buffer.writeFloatLE(depthFit.b, 44);
  buffer.writeUInt32LE(seed, 48);

  let offset = HEADER_BYTES;
  for (const points of [stipple, glow]) {
    for (let index = 0; index < points.u.length; index += 1) {
      buffer.writeUInt16LE(Math.round(points.u[index] * 65_535), offset);
      buffer.writeUInt16LE(Math.round(points.v[index] * 65_535), offset + 2);
      buffer.writeUInt8(Math.round(points.tone[index]), offset + 4);
      offset += POINT_RECORD_BYTES;
    }
  }
  offset += (4 - (offset % 4)) % 4;
  for (let index = 0; index < landmarks.length; index += 1) {
    const landmark = landmarks[index];
    finite(landmark.x, `landmarks[${index}].x`);
    finite(landmark.y, `landmarks[${index}].y`);
    finite(landmark.z, `landmarks[${index}].z`);
    buffer.writeFloatLE(landmark.x, offset);
    buffer.writeFloatLE(landmark.y, offset + 4);
    buffer.writeFloatLE(landmark.z, offset + 8);
    offset += LANDMARK_RECORD_BYTES;
  }
  Buffer.from(depth.buffer, depth.byteOffset, depth.byteLength).copy(buffer, offset);
  validateFaceAsset(buffer);
  return buffer;
}

export function validateFaceAsset(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  invariant(buffer.length >= HEADER_BYTES, "file is shorter than the header");
  invariant(buffer.toString("ascii", 0, 4) === "AVAF", "magic is not AVAF");
  invariant(buffer.readUInt16LE(4) === FACE_ASSET_SCHEMA, "schema version is unsupported");
  invariant(buffer.readUInt16LE(6) === 0, "flags must be zero");
  const stipple = buffer.readUInt32LE(8);
  const glow = buffer.readUInt32LE(12);
  const landmarks = buffer.readUInt32LE(16);
  const depthSize = buffer.readUInt16LE(20);
  invariant(stipple >= 1 && stipple <= 120_000, "stipple count is invalid");
  invariant(glow >= 1 && glow <= 80_000, "glow count is invalid");
  invariant(landmarks === LANDMARK_COUNT, "landmark count is not 478");
  invariant(depthSize >= 16 && depthSize <= 512, "depth size is invalid");
  invariant(buffer.readUInt16LE(22) === 0, "reserved header word must be zero");
  for (let index = 52; index < HEADER_BYTES; index += 1) {
    invariant(buffer[index] === 0, "reserved header bytes must be zero");
  }
  const crop = {
    cx: buffer.readFloatLE(24),
    cy: buffer.readFloatLE(28),
    halfX: buffer.readFloatLE(32),
    halfY: buffer.readFloatLE(36),
  };
  const depthFit = { a: buffer.readFloatLE(40), b: buffer.readFloatLE(44) };
  for (const [key, value] of Object.entries(crop)) finite(value, `crop.${key}`);
  finite(depthFit.a, "depthFit.a");
  finite(depthFit.b, "depthFit.b");
  invariant(crop.halfX > 0 && crop.halfX <= 0.5 && crop.halfY > 0 && crop.halfY <= 0.5, "crop half extents are invalid");
  invariant(crop.cx - crop.halfX >= -1e-6 && crop.cx + crop.halfX <= 1 + 1e-6, "crop x extent leaves the source");
  invariant(crop.cy - crop.halfY >= -1e-6 && crop.cy + crop.halfY <= 1 + 1e-6, "crop y extent leaves the source");
  const expected = expectedFaceAssetBytes({ stipple, glow, landmarks, depthSize });
  invariant(buffer.length === expected, `file is ${buffer.length} bytes; expected exactly ${expected}`);
  const pointsEnd = HEADER_BYTES + POINT_RECORD_BYTES * (stipple + glow);
  const aligned = pointsEnd + ((4 - (pointsEnd % 4)) % 4);
  for (let index = pointsEnd; index < aligned; index += 1) invariant(buffer[index] === 0, "alignment padding must be zero");
  return {
    schema: FACE_ASSET_SCHEMA,
    stipple,
    glow,
    landmarks,
    depthSize,
    crop,
    depthFit,
    seed: buffer.readUInt32LE(48),
    bytes: buffer.length,
  };
}

export function validateFaceManifest(manifest, buffer) {
  const parsed = validateFaceAsset(buffer);
  invariant(manifest && manifest.schema === FACE_ASSET_SCHEMA, "manifest schema is unsupported");
  invariant(typeof manifest.version === "string" && manifest.version.length > 0, "manifest version is missing");
  invariant(/^ava-face\.[a-f0-9]{8}\.bin$/.test(manifest.file), "manifest file name is invalid");
  invariant(manifest.sha256 === sha256(buffer), "manifest SHA-256 does not match the binary");
  invariant(manifest.file === `ava-face.${manifest.sha256.slice(0, 8)}.bin`, "manifest file hash suffix is wrong");
  invariant(manifest.bytes === buffer.length, "manifest byte count does not match the binary");
  invariant(manifest.seed === parsed.seed, "manifest seed does not match the binary");
  invariant(manifest.counts?.stipple === parsed.stipple, "manifest stipple count does not match");
  invariant(manifest.counts?.glow === parsed.glow, "manifest glow count does not match");
  invariant(manifest.counts?.landmarks === parsed.landmarks, "manifest landmark count does not match");
  invariant(manifest.counts?.depthSize === parsed.depthSize, "manifest depth size does not match");
  invariant(Array.isArray(manifest.models) && manifest.models.length >= 2, "manifest model provenance is incomplete");
  invariant(Array.isArray(manifest.licences) && manifest.licences.length >= 2, "manifest licence provenance is incomplete");
  invariant(manifest.source === "private AI portrait (not committed)", "manifest source disclosure is wrong");
  return parsed;
}
