/**
 * Runtime reader for AVA's face asset (contract face-asset v1 §6).
 *
 * The asset is derived data only: shuffled point sets, 478 face landmarks and a
 * depth grid, all in crop-local coordinates. Every header field and the exact
 * byte length are validated before anything is handed to WebGL; any mismatch
 * throws FaceAssetError and the caller shows the static fallback instead.
 */

export const FACE_ASSET_SCHEMA = 1;
export const HEADER_BYTES = 64;
export const POINT_BYTES = 5;
export const LANDMARK_COUNT = 478;

export type FaceAssetErrorCode =
  | "bad_magic" | "bad_version" | "bad_flags" | "bad_counts" | "bad_reserved"
  | "bad_crop" | "bad_fit" | "bad_length" | "bad_manifest" | "bad_hash" | "fetch_failed";

export class FaceAssetError extends Error {
  constructor(readonly code: FaceAssetErrorCode, message: string) {
    super(message);
    this.name = "FaceAssetError";
  }
}

export type Crop = { cx: number; cy: number; halfX: number; halfY: number };

/** A set of interleaved 5-byte point records { u u16, v u16, tone u8 }, read through a DataView. */
export class PointSet {
  constructor(private readonly view: DataView, private readonly offset: number, readonly count: number) {}
  /** Crop-local horizontal position, 0..1. */
  u(i: number): number { return this.view.getUint16(this.offset + i * POINT_BYTES, true) / 65535; }
  /** Crop-local vertical position, 0..1 (down). */
  v(i: number): number { return this.view.getUint16(this.offset + i * POINT_BYTES + 2, true) / 65535; }
  /** Luminance at the point, 0..1. */
  tone(i: number): number { return this.view.getUint8(this.offset + i * POINT_BYTES + 4) / 255; }
}

export type FaceAsset = {
  stipple: PointSet;
  glow: PointSet;
  /** 478 × {x, y, z}: crop-local x/y, MediaPipe z in source-width units (negative = closer). */
  landmarks: Float32Array;
  /** depthSize² bytes, row-major over the crop; larger = closer. */
  depth: Uint8Array;
  depthSize: number;
  crop: Crop;
  /** z ≈ a·d + b, in landmark z units. */
  depthFit: { a: number; b: number };
  seed: number;
  bytes: number;
};

export type FaceManifest = {
  schema: number;
  file: string;
  sha256: string;
  bytes: number;
};

const EPS = 1e-6;

export function expectedLength(stipple: number, glow: number, landmarks: number, depthSize: number): number {
  const points = HEADER_BYTES + POINT_BYTES * (stipple + glow);
  const pad = (4 - (points % 4)) % 4;
  return points + pad + 12 * landmarks + depthSize * depthSize;
}

/** Validate and view a face asset buffer. Throws FaceAssetError; never allocates for WebGL. */
export function parseFaceAsset(buffer: ArrayBuffer): FaceAsset {
  if (buffer.byteLength < HEADER_BYTES) throw new FaceAssetError("bad_length", "Face asset is shorter than its header.");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "AVAF") throw new FaceAssetError("bad_magic", "Not an AVA face asset.");
  if (view.getUint16(4, true) !== FACE_ASSET_SCHEMA) throw new FaceAssetError("bad_version", "Unsupported face asset version.");
  if (view.getUint16(6, true) !== 0) throw new FaceAssetError("bad_flags", "Unknown face asset flags.");

  const stippleCount = view.getUint32(8, true);
  const glowCount = view.getUint32(12, true);
  const landmarkCount = view.getUint32(16, true);
  const depthSize = view.getUint16(20, true);
  if (stippleCount < 1 || stippleCount > 120_000 || glowCount < 1 || glowCount > 80_000 ||
      landmarkCount !== LANDMARK_COUNT || depthSize < 16 || depthSize > 512) {
    throw new FaceAssetError("bad_counts", "Face asset counts are out of range.");
  }
  if (view.getUint16(22, true) !== 0) throw new FaceAssetError("bad_reserved", "Reserved header bytes must be zero.");
  for (let at = 52; at < HEADER_BYTES; at++) {
    if (view.getUint8(at) !== 0) throw new FaceAssetError("bad_reserved", "Reserved header bytes must be zero.");
  }

  const crop: Crop = { cx: view.getFloat32(24, true), cy: view.getFloat32(28, true), halfX: view.getFloat32(32, true), halfY: view.getFloat32(36, true) };
  const finite = [crop.cx, crop.cy, crop.halfX, crop.halfY].every(Number.isFinite);
  if (!finite || crop.halfX <= 0 || crop.halfY <= 0 || crop.halfX > 0.5 || crop.halfY > 0.5 ||
      crop.cx - crop.halfX < -EPS || crop.cx + crop.halfX > 1 + EPS || crop.cy - crop.halfY < -EPS || crop.cy + crop.halfY > 1 + EPS) {
    throw new FaceAssetError("bad_crop", "Face asset crop is outside the source image.");
  }
  const depthFit = { a: view.getFloat32(40, true), b: view.getFloat32(44, true) };
  if (!Number.isFinite(depthFit.a) || !Number.isFinite(depthFit.b)) throw new FaceAssetError("bad_fit", "Face asset depth fit is not finite.");
  const seed = view.getUint32(48, true);

  const length = expectedLength(stippleCount, glowCount, landmarkCount, depthSize);
  if (buffer.byteLength !== length) throw new FaceAssetError("bad_length", "Face asset length does not match its header.");

  const stippleOffset = HEADER_BYTES;
  const glowOffset = stippleOffset + POINT_BYTES * stippleCount;
  const pointsEnd = glowOffset + POINT_BYTES * glowCount;
  const landmarkOffset = pointsEnd + ((4 - (pointsEnd % 4)) % 4);
  const depthOffset = landmarkOffset + 12 * landmarkCount;

  const landmarks = new Float32Array(buffer, landmarkOffset, landmarkCount * 3);
  for (let i = 0; i < landmarks.length; i++) {
    if (!Number.isFinite(landmarks[i]!)) throw new FaceAssetError("bad_counts", "Face landmarks are not finite.");
  }

  return {
    stipple: new PointSet(view, stippleOffset, stippleCount),
    glow: new PointSet(view, glowOffset, glowCount),
    landmarks,
    depth: new Uint8Array(buffer, depthOffset, depthSize * depthSize),
    depthSize,
    crop,
    depthFit,
    seed,
    bytes: buffer.byteLength,
  };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validManifest(value: unknown): value is FaceManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<FaceManifest>;
  return m.schema === FACE_ASSET_SCHEMA && typeof m.file === "string" && /^ava-face\.[0-9a-f]{8}\.bin$/.test(m.file) &&
    typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) && Number.isInteger(m.bytes) && Number(m.bytes) > HEADER_BYTES;
}

/**
 * Fetch the manifest, then the exact file it names, and verify size and
 * SHA-256 (when the browser offers SubtleCrypto) before parsing.
 */
export async function loadFaceAsset(base = "/face/", fetchImpl: typeof fetch = fetch): Promise<FaceAsset> {
  let manifest: unknown;
  try {
    const response = await fetchImpl(`${base}manifest.json`);
    if (!response.ok) throw new Error(String(response.status));
    manifest = await response.json();
  } catch {
    throw new FaceAssetError("fetch_failed", "The face manifest could not be loaded.");
  }
  if (!validManifest(manifest)) throw new FaceAssetError("bad_manifest", "The face manifest is not valid.");
  let buffer: ArrayBuffer;
  try {
    const response = await fetchImpl(`${base}${manifest.file}`);
    if (!response.ok) throw new Error(String(response.status));
    buffer = await response.arrayBuffer();
  } catch {
    throw new FaceAssetError("fetch_failed", "The face asset could not be loaded.");
  }
  if (buffer.byteLength !== manifest.bytes) throw new FaceAssetError("bad_length", "The face asset size does not match its manifest.");
  const hash = await sha256Hex(buffer);
  if (hash !== null && hash !== manifest.sha256) throw new FaceAssetError("bad_hash", "The face asset does not match its manifest.");
  return parseFaceAsset(buffer);
}

let cached: Promise<FaceAsset> | null = null;
/** One shared load per page; a failure is not cached, so a later mount can retry. */
export function sharedFaceAsset(): Promise<FaceAsset> {
  if (!cached) cached = loadFaceAsset().catch((error: unknown) => { cached = null; throw error; });
  return cached;
}
