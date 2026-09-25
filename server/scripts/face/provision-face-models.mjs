import { provisionFaceModelCache } from "./face-models.mjs";

await provisionFaceModelCache();
console.log("AVA face build models are provisioned and match their pinned SHA-256 values.");
