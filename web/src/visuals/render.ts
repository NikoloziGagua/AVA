import type { VisualExplanation, VisualScene, VisualTopology } from "./api.js";

const SAFE_SVG_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line",
  "text", "tspan", "defs", "marker", "clippath", "lineargradient", "radialgradient",
  "stop", "style", "title", "desc",
]);

function quoteLabel(label: string): string {
  return label.replace(/["\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

function nodeStatement(node: VisualTopology["nodes"][number]): string {
  const label = quoteLabel(node.label);
  if (node.shape === "decision") return `${node.id}{"${label}"}`;
  if (node.shape === "terminal") return `${node.id}(["${label}"])`;
  return `${node.id}["${label}"]`;
}

function edgeStatement(edge: VisualTopology["edges"][number]): string {
  const operator = edge.style === "dotted" ? "-.->" : edge.style === "strong" ? "==>" : "-->";
  return `${edge.from} ${operator}${edge.label ? `|${quoteLabel(edge.label)}| ` : " "}${edge.to}`;
}

/** Project one small storyboard scene from canonical topology. This generated
 * Mermaid is disposable; the stored Mermaid remains the source of truth. */
export function buildSceneMermaid(visual: VisualExplanation, scene: VisualScene): string {
  const visible = new Set(scene.nodeIds);
  const nodes = visual.topology.nodes.filter((node) => visible.has(node.id));
  const edges = visual.topology.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  const lines = [`flowchart ${visual.topology.direction}`];
  for (const node of nodes) lines.push(`  ${nodeStatement(node)}`);
  for (const edge of edges) lines.push(`  ${edgeStatement(edge)}`);
  if (scene.highlightNodeIds.length) {
    lines.push("  classDef avaFocus fill:#12343c,stroke:#5cf2ff,stroke-width:3px,color:#f4feff");
    lines.push(`  class ${scene.highlightNodeIds.join(",")} avaFocus`);
  }
  return lines.join("\n");
}

function safeCss(value: string): string {
  if (/@import|expression\s*\(|javascript\s*:|https?:|data\s*:/i.test(value)) return "";
  return value;
}

/** Defense in depth after Mermaid's strict renderer. Only inert SVG survives. */
export function sanitizeRenderedSvg(raw: string, title: string, description: string): string {
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.localName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("The diagram renderer returned invalid SVG.");
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    const name = element.localName.toLowerCase();
    if (!SAFE_SVG_ELEMENTS.has(name)) {
      // Unknown SVG/HTML containers are removed with their contents. Unwrapping
      // would let script text or foreign HTML leak into an otherwise inert SVG.
      if (element !== svg) element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const attr = attribute.name.toLowerCase();
      const value = attribute.value;
      const unsafeName = attr.startsWith("on") || attr === "href" || attr === "xlink:href" || attr === "src";
      const unsafeValue = /javascript\s*:|https?:|data\s*:/i.test(value);
      if (unsafeName || unsafeValue) element.removeAttribute(attribute.name);
      else if (attr === "style") {
        const cleaned = safeCss(value);
        if (cleaned) element.setAttribute("style", cleaned); else element.removeAttribute("style");
      }
    }
    if (name === "style") element.textContent = safeCss(element.textContent ?? "");
  }
  svg.removeAttribute("xmlns:xlink");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "ava-visual-title ava-visual-desc");
  svg.querySelector("title")?.remove();
  svg.querySelector("desc")?.remove();
  const titleNode = doc.createElementNS("http://www.w3.org/2000/svg", "title");
  titleNode.setAttribute("id", "ava-visual-title");
  titleNode.textContent = title;
  const descNode = doc.createElementNS("http://www.w3.org/2000/svg", "desc");
  descNode.setAttribute("id", "ava-visual-desc");
  descNode.textContent = description;
  svg.prepend(descNode);
  svg.prepend(titleNode);
  return new XMLSerializer().serializeToString(svg);
}

export async function renderMermaidSvg(source: string, id: string, title: string, description: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark",
    deterministicIds: true,
    deterministicIDSeed: id,
    flowchart: { htmlLabels: false, useMaxWidth: true, curve: "basis" },
    themeVariables: {
      background: "#05080b",
      primaryColor: "#10252c",
      primaryTextColor: "#ecfeff",
      primaryBorderColor: "#5cf2ff",
      lineColor: "#7894a0",
      secondaryColor: "#17152a",
      tertiaryColor: "#0b1217",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    },
  });
  const rendered = await mermaid.render(`ava_visual_${id.replace(/[^A-Za-z0-9_]/g, "_")}`, source);
  return sanitizeRenderedSvg(rendered.svg, title, description);
}

export function buildSandboxDocument(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; media-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;min-height:100%;background:#05080b;color:#fff}body{display:grid;place-items:center;padding:20px;box-sizing:border-box}svg{display:block;max-width:100%;height:auto;max-height:680px}</style></head><body>${svg}</body></html>`;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ava-visual";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadSvg(svg: string, title: string, sceneTitle: string): void {
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(title)}-${safeFilename(sceneTitle)}.svg`);
}

export async function downloadPng(svg: string, title: string, sceneTitle: string): Promise<void> {
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The SVG could not be converted to PNG."));
      image.src = url;
    });
    const width = Math.min(2400, Math.max(800, image.naturalWidth || 1200));
    const ratio = (image.naturalHeight || 700) / Math.max(1, image.naturalWidth || 1200);
    const height = Math.min(1800, Math.max(500, Math.round(width * ratio)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.fillStyle = "#05080b";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")),
      "image/png",
    ));
    downloadBlob(png, `${safeFilename(title)}-${safeFilename(sceneTitle)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
