import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const MODEL_CACHE_ROOT = fileURLToPath(new URL("../../data/face/models/", import.meta.url));

export const MEDIAPIPE = Object.freeze({
  name: "MediaPipe Face Landmarker",
  package: "@mediapipe/tasks-vision",
  packageVersion: "0.10.14",
  modelVersion: "float16/1",
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  path: join(MODEL_CACHE_ROOT, "mediapipe", "face_landmarker.task"),
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  licence: "Apache-2.0",
});

export const DEPTH_ANYTHING = Object.freeze({
  name: "Depth Anything V2 Small",
  package: "@huggingface/transformers",
  packageVersion: "3.8.1",
  repository: "onnx-community/depth-anything-v2-small",
  revision: "4472b7362082ad9968fee890ca0f1e5aca36b93d",
  cacheDirectory: join(MODEL_CACHE_ROOT, "huggingface"),
  files: Object.freeze([
    Object.freeze({
      relative: "config.json",
      bytes: 38,
      sha256: "3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5",
    }),
    Object.freeze({
      relative: "preprocessor_config.json",
      bytes: 461,
      sha256: "03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6",
    }),
    Object.freeze({
      relative: "onnx/model.onnx",
      bytes: 99_060_839,
      sha256: "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
    }),
  ]),
  licence: "Apache-2.0",
});

export function depthModelDirectory() {
  return join(
    DEPTH_ANYTHING.cacheDirectory,
    ...DEPTH_ANYTHING.repository.split("/"),
    DEPTH_ANYTHING.revision,
  );
}

export const MODEL_PROVENANCE = Object.freeze([
  Object.freeze({
    name: MEDIAPIPE.name,
    version: `${MEDIAPIPE.package}@${MEDIAPIPE.packageVersion}; model ${MEDIAPIPE.modelVersion}`,
    sha256: MEDIAPIPE.sha256,
  }),
  Object.freeze({
    name: DEPTH_ANYTHING.name,
    version: `${DEPTH_ANYTHING.package}@${DEPTH_ANYTHING.packageVersion}; revision ${DEPTH_ANYTHING.revision}`,
    sha256: DEPTH_ANYTHING.files.find((file) => file.relative === "onnx/model.onnx").sha256,
  }),
]);

export const MODEL_LICENCES = Object.freeze([
  Object.freeze({ name: MEDIAPIPE.name, licence: MEDIAPIPE.licence }),
  Object.freeze({ name: DEPTH_ANYTHING.name, licence: DEPTH_ANYTHING.licence }),
]);
