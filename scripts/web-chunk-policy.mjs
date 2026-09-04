/**
 * Deterministic production chunk ownership for AVA's measured dependency graph.
 *
 * Keep this list package-oriented: source-file rules are brittle and can split a
 * library across circular chunks. Application modules deliberately stay in the
 * entry chunk; three measured heavyweight workspaces use their real navigation
 * boundary in App.tsx.
 */
const PACKAGE_GROUPS = [
  ["vendor-animation", ["@gsap/react", "gsap", "motion", "motion-dom", "motion-utils", "framer-motion"]],
  ["vendor-diagrams", [
    "@dagrejs/dagre", "@xyflow/react", "@xyflow/system", "d3-array", "d3-color",
    "d3-dispatch", "d3-drag", "d3-ease", "d3-geo", "d3-interpolate", "d3-selection",
    "d3-timer", "d3-transition", "d3-zoom", "internmap", "topojson-client", "world-atlas",
  ]],
  ["vendor-markdown", [
    "@types/hast", "@types/mdast", "@types/unist", "bail", "character-entities",
    "character-entities-html4", "character-entities-legacy", "comma-separated-tokens",
    "decode-named-character-reference", "devlop", "hast-util-to-jsx-runtime",
    "hast-util-whitespace", "html-url-attributes", "is-alphabetical", "is-alphanumerical",
    "is-decimal", "is-hexadecimal", "longest-streak", "markdown-table",
    "mdast-util-find-and-replace", "mdast-util-from-markdown", "mdast-util-gfm",
    "mdast-util-gfm-autolink-literal", "mdast-util-gfm-footnote",
    "mdast-util-gfm-strikethrough", "mdast-util-gfm-table", "mdast-util-gfm-task-list-item",
    "mdast-util-phrasing", "mdast-util-to-hast", "mdast-util-to-markdown", "micromark",
    "micromark-core-commonmark", "micromark-extension-gfm",
    "micromark-extension-gfm-autolink-literal", "micromark-extension-gfm-footnote",
    "micromark-extension-gfm-strikethrough", "micromark-extension-gfm-table",
    "micromark-extension-gfm-tagfilter", "micromark-extension-gfm-task-list-item",
    "micromark-factory-destination", "micromark-factory-label", "micromark-factory-space",
    "micromark-factory-title", "micromark-factory-whitespace", "micromark-util-character",
    "micromark-util-chunked", "micromark-util-classify-character",
    "micromark-util-combine-extensions", "micromark-util-decode-numeric-character-reference",
    "micromark-util-decode-string", "micromark-util-encode", "micromark-util-html-tag-name",
    "micromark-util-normalize-identifier", "micromark-util-resolve-all",
    "micromark-util-sanitize-uri", "micromark-util-subtokenize", "micromark-util-symbol",
    "micromark-util-types", "property-information", "react-markdown", "remark-gfm",
    "remark-parse", "remark-rehype", "space-separated-tokens", "trim-lines", "trough",
    "unified", "unist-util-is", "unist-util-position", "unist-util-stringify-position",
    "unist-util-visit", "unist-util-visit-parents", "vfile", "vfile-message", "zwitch",
  ]],
  ["vendor-react", ["react", "react-dom", "react-is", "scheduler", "use-sync-external-store"]],
];

export const PRODUCTION_CHUNK_SIZE_LIMIT_BYTES = 500_000;
export const REQUIRED_PRODUCTION_CHUNKS = [
  "vendor-three-core",
  "vendor-three-renderer",
  "vendor-three-effects",
  ...PACKAGE_GROUPS.map(([name]) => name),
];

function packageName(moduleId) {
  const normalized = moduleId.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerAt = normalized.lastIndexOf(marker);
  if (markerAt < 0) return null;
  const parts = normalized.slice(markerAt + marker.length).split("/");
  if (!parts[0]) return null;
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
}

/** Used directly by Rollup's `output.manualChunks` hook. */
export function productionChunkForModule(moduleId) {
  const normalized = moduleId.replaceAll("\\", "/");
  // Three publishes a one-way build graph: the renderer entry imports its core,
  // and examples/postprocessing import the public renderer entry. These are
  // whole upstream modules—not arbitrary source fragments—so preserving those
  // three documented boundaries is deterministic and cycle-free.
  if (normalized.includes("/node_modules/three/examples/")) return "vendor-three-effects";
  if (normalized.endsWith("/node_modules/three/build/three.core.js")) return "vendor-three-core";
  if (normalized.endsWith("/node_modules/three/build/three.module.js")) return "vendor-three-renderer";
  const dependency = packageName(moduleId);
  if (dependency === "three") return "vendor-three-renderer";
  if (!dependency) return undefined;
  for (const [chunk, packages] of PACKAGE_GROUPS) {
    if (packages.includes(dependency)) return chunk;
  }
  return "vendor-core";
}
