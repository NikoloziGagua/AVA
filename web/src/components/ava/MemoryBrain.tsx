import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import type { MemoryView } from "../../api.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

/** A picked graph node, handed to `onSelect` for the inspector card. */
export type BrainNode = {
  id: string;
  kind: "core" | "category" | "observation" | "preference" | "project";
  label: string;
  text: string;
  category?: string;
  confidence?: "low" | "medium" | "high";
  date?: string;
};

export interface MemoryBrainProps {
  memory: MemoryView;
  onSelect?: (node: BrainNode | null) => void;
  /** When false, the gentle idle auto-rotation pauses (drag/zoom + pulses still run). */
  spinning?: boolean;
  className?: string;
}

/**
 * 3D "memory brain": a rotatable / zoomable neural-network view of Ava's memory.
 *
 * Raw three.js (no @react-three/fiber, no OrbitControls). Lifecycle mirrors
 * DottedSurface/NeuralField: renderer + scene + camera built in one useEffect,
 * sized to the CONTAINER, DPR capped ~1.5, a single rAF loop, and a cleanup that
 * cancels the frame and disposes every geometry/material/texture + loses the GL
 * context + removes the canvas.
 *
 * Layout is computed ONCE (no live physics) so it never feels sluggish. The render
 * stack — four draw calls total, all additive:
 *   1. DUST    — a sparse twinkling particle shell around the graph (atmosphere).
 *   2. HALOS   — the same node geometry drawn big + soft (corona glow per node).
 *   3. EDGES   — curved dendrite polylines (quadratic bézier, sampled) carrying
 *                travelling light pulses, tinted by their hub's color; plus a
 *                dimmer "web" of cross-links between sibling leaves / hub ring.
 *   4. NODES   — the crisp glowing cores with per-node twinkle + hover size bump.
 * Far elements fade with view depth (uCamDist) so the network reads with real
 * spatial depth instead of a flat wireframe.
 *
 * jsdom has no WebGL (`getContext` → null); we then render a static CSS "memory
 * map" placeholder and return early WITHOUT throwing, so the smoke test mounts.
 * Reduced motion renders a single static frame (no idle spin / no pulses).
 */

// ── palette (cyan / mercury command-deck) ───────────────────────────────────
const CORE_COLOR = new THREE.Color("#eaf9ff"); // near-white mercury

// Distinct-but-cool hue per category, staying in the cyan/teal/violet range.
const CATEGORY_COLORS: Record<string, string> = {
  context: "#5cf2ff", // lead cyan
  people: "#7aa2ff", // periwinkle
  setup: "#46e8c8", // teal
  skills: "#8f7bff", // violet
  schedule: "#5fd0ff", // sky
  preferences: "#b59cff", // lilac
  projects: "#62f2d0", // aqua-green
};
function categoryColor(cat: string): THREE.Color {
  return new THREE.Color(CATEGORY_COLORS[cat] ?? "#7fd8e6");
}

// ── tiny deterministic hash → [0,1) (NO Math.random; stable per id/index) ────
function hash01(n: number): number {
  // xorshift-ish integer scramble, then normalize.
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 100000) / 100000;
}
/** A small signed jitter in [-amp, amp], decorrelated per (seed, axis). */
function jitter(seed: number, axis: number, amp: number): number {
  return (hash01(seed * 7 + axis * 131 + 17) - 0.5) * 2 * amp;
}

/** Collapse whitespace + truncate to ~max chars for the hover-reveal label. */
function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Point sizes (world units; sizeAttenuation on). Core > hubs > leaves.
const SIZE_CORE = 40;
const SIZE_HUB = 26;
const CONF_SIZE: Record<"low" | "medium" | "high", number> = {
  high: 16,
  medium: 12.5,
  low: 9,
};

const MAX_NODES = 400;
// Samples per curved edge: each edge becomes CURVE_SEG line segments along a
// quadratic bézier, so pulses travel along an organic dendrite, not a chord.
const CURVE_SEG = 10;
const DUST_COUNT = 400;

// A full graph node with its computed position + render attributes.
interface GraphNode extends BrainNode {
  pos: THREE.Vector3;
  color: THREE.Color;
  size: number;
  dim: boolean; // superseded observations render faint
}

// An edge with the hub tint that colors its pulse + its layer kind.
interface GraphEdge {
  a: number;
  b: number;
  tint: THREE.Color;
  /** 0 = primary spoke (core→hub, hub→leaf), 1 = dim cross-link web. */
  kind: 0 | 1;
}

/** Build the node + edge model and the one-shot layout from a MemoryView. */
function buildGraph(memory: MemoryView): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // 0 — core at the origin.
  nodes.push({
    id: "core",
    kind: "core",
    label: "Ava",
    text: memory.personality?.trim() || "Ava — central memory core.",
    pos: new THREE.Vector3(0, 0, 0),
    color: CORE_COLOR.clone(),
    size: SIZE_CORE,
    dim: false,
  });

  // ── group the leaves under their hubs first (so we know hub count + sizing).
  // Observation categories, in first-seen order, each become a hub.
  const obsByCat = new Map<string, MemoryView["observations"]["lines"]>();
  for (const line of memory.observations.lines) {
    const arr = obsByCat.get(line.category);
    if (arr) arr.push(line);
    else obsByCat.set(line.category, [line]);
  }

  // Hub descriptors: an id, label, color and the leaf builder for each.
  interface HubSpec {
    id: string;
    label: string;
    color: THREE.Color;
    leaves: Array<Omit<GraphNode, "pos"> & { recency: number }>;
  }
  const hubs: HubSpec[] = [];

  // observation category hubs
  for (const [cat, lines] of obsByCat) {
    const color = categoryColor(cat);
    const leaves = lines.map((l, i) => ({
      id: `obs:${l.raw}`,
      kind: "observation" as const,
      label: l.text.length > 48 ? l.text.slice(0, 47) + "…" : l.text,
      text: l.text,
      category: l.category,
      confidence: l.confidence,
      date: l.date,
      color: color.clone(),
      size: CONF_SIZE[l.confidence],
      dim: l.superseded != null,
      // recency rank for the >MAX_NODES trim: confidence weight + position bias.
      recency:
        (l.confidence === "high" ? 3 : l.confidence === "medium" ? 2 : 1) * 1000 +
        (lines.length - i) +
        (l.superseded != null ? -5000 : 0),
    }));
    hubs.push({ id: `hub:${cat}`, label: cat, color, leaves });
  }

  // preferences hub
  {
    const color = categoryColor("preferences");
    const leaves = memory.preferences.lines.map((line, i) => ({
      id: `pref:${line}`,
      kind: "preference" as const,
      label: line.length > 48 ? line.slice(0, 47) + "…" : line,
      text: line,
      category: "preferences",
      color: color.clone(),
      size: CONF_SIZE.medium,
      dim: false,
      recency: 2000 + (memory.preferences.lines.length - i),
    }));
    hubs.push({ id: "hub:preferences", label: "preferences", color, leaves });
  }

  // projects hub
  {
    const color = categoryColor("projects");
    const leaves = memory.projects.map((p, i) => ({
      id: `proj:${p.slug}`,
      kind: "project" as const,
      label: p.slug,
      text: p.body?.trim() || p.slug,
      category: "projects",
      color: color.clone(),
      size: CONF_SIZE.high,
      dim: false,
      recency: 2500 + (memory.projects.length - i),
    }));
    hubs.push({ id: "hub:projects", label: "projects", color, leaves });
  }

  // ── budget: if leaves blow past MAX_NODES, keep the strongest/most-recent and
  // warn (never silently truncate). Core + hubs are always kept.
  const hubCount = hubs.length;
  const leafBudget = Math.max(0, MAX_NODES - 1 - hubCount);
  const totalLeaves = hubs.reduce((n, h) => n + h.leaves.length, 0);
  let dropped = 0;
  if (totalLeaves > leafBudget) {
    // Flatten with a back-reference to the owning hub, sort by recency desc, keep
    // the top `leafBudget`, then regroup.
    const flat = hubs.flatMap((h, hi) => h.leaves.map((leaf) => ({ hi, leaf })));
    flat.sort((a, b) => b.leaf.recency - a.leaf.recency);
    const keep = new Set(flat.slice(0, leafBudget).map((f) => f.leaf.id));
    dropped = totalLeaves - leafBudget;
    for (const h of hubs) h.leaves = h.leaves.filter((l) => keep.has(l.id));
    console.warn(
      `MemoryBrain: ${totalLeaves} leaf nodes exceeded the ${leafBudget} budget; ` +
        `dropped ${dropped} lowest-confidence/oldest leaves.`,
    );
  }

  // ── place hubs on a fibonacci (golden-spiral) sphere around the core ─────────
  const HUB_RADIUS = 170;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.399963
  const hubIndices: number[] = [];
  hubs.forEach((hub, h) => {
    const hubIndex = nodes.length;
    hubIndices.push(hubIndex);
    // Even sphere distribution + a small deterministic radius wobble so it reads
    // organic rather than a perfect shell.
    const t = hubCount > 1 ? h / (hubCount - 1) : 0.5;
    const y = 1 - t * 2; // 1 → -1
    const ringR = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * h;
    const rad = HUB_RADIUS * (0.9 + hash01(h * 13 + 3) * 0.25);
    const hubPos = new THREE.Vector3(
      Math.cos(theta) * ringR * rad,
      y * rad,
      Math.sin(theta) * ringR * rad,
    );
    nodes.push({
      id: hub.id,
      kind: "category",
      label: hub.label,
      text: `${hub.label} — ${hub.leaves.length} item${hub.leaves.length === 1 ? "" : "s"}.`,
      category: hub.label,
      pos: hubPos,
      color: hub.color.clone(),
      size: SIZE_HUB,
      dim: false,
    });
    edges.push({ a: 0, b: hubIndex, tint: hub.color.clone(), kind: 0 }); // core → hub

    // ── leaves cluster in a small jittered cloud just outside the hub ──────────
    const cloud = 46 + Math.min(36, hub.leaves.length * 1.4);
    const leafIndices: number[] = [];
    hub.leaves.forEach((leaf, li) => {
      const seed = h * 1009 + li * 31 + 1;
      // Direction biased outward from the core through the hub, plus jitter.
      const dir = hubPos
        .clone()
        .normalize()
        .multiplyScalar(0.6)
        .add(new THREE.Vector3(jitter(seed, 0, 1), jitter(seed, 1, 1), jitter(seed, 2, 1)))
        .normalize();
      const dist = cloud * (0.55 + hash01(seed) * 0.9);
      const leafPos = hubPos.clone().add(dir.multiplyScalar(dist));
      const leafIndex = nodes.length;
      leafIndices.push(leafIndex);
      nodes.push({
        ...leaf,
        pos: leafPos,
      });
      edges.push({ a: hubIndex, b: leafIndex, tint: hub.color.clone(), kind: 0 }); // hub → leaf
    });

    // ── cross-link web: faint dendrites between SIBLING leaves so each cluster
    // reads as interconnected tissue, not a star burst. Deterministic ~40% of
    // adjacent sibling pairs link up; drawn dim (kind 1) so the spokes stay primary.
    for (let li = 0; li + 1 < leafIndices.length; li++) {
      if (hash01(h * 7919 + li * 233 + 5) < 0.4) {
        edges.push({ a: leafIndices[li]!, b: leafIndices[li + 1]!, tint: hub.color.clone(), kind: 1 });
      }
    }
  });

  // ── hub ring: whisper-faint long arcs between neighbouring hubs — the cortex's
  // association fibres. Only with 3+ hubs (a 2-hub "ring" is just a doubled edge).
  if (hubIndices.length >= 3) {
    for (let h = 0; h < hubIndices.length; h++) {
      const a = hubIndices[h]!;
      const b = hubIndices[(h + 1) % hubIndices.length]!;
      edges.push({ a, b, tint: nodes[b]!.color.clone(), kind: 1 });
    }
  }

  // ── long-range association fibres: faint arcs between leaves of DIFFERENT
  // clusters. A few dozen of these span the empty middle volume and make the
  // graph read as one connected cortex instead of isolated star-bursts.
  // Deterministic picks; capped so a small memory never turns into spaghetti.
  const leafIdx: Array<{ idx: number; hub: number }> = [];
  nodes.forEach((n, i) => {
    if (n.kind !== "core" && n.kind !== "category") {
      leafIdx.push({ idx: i, hub: hubIndices.findIndex((hi) => nodes[hi]!.category === n.category) });
    }
  });
  const want = Math.min(36, Math.floor(leafIdx.length * 0.7));
  let made = 0;
  for (let k = 0; k < want * 4 && made < want; k++) {
    const a = leafIdx[Math.floor(hash01(k * 433 + 7) * leafIdx.length)];
    const b = leafIdx[Math.floor(hash01(k * 991 + 19) * leafIdx.length)];
    if (!a || !b || a.idx === b.idx || a.hub === b.hub) continue;
    edges.push({ a: a.idx, b: b.idx, tint: nodes[b.idx]!.color.clone(), kind: 1 });
    made++;
  }

  return { nodes, edges };
}

/** A soft radial-gradient sprite so each point glows (white core → transparent). */
function makeSpriteTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.85)");
    g.addColorStop(0.55, "rgba(255,255,255,0.28)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/** A wider, softer falloff for the halo/corona layer (no hot center). */
function makeHaloTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.4, "rgba(255,255,255,0.22)");
    g.addColorStop(0.75, "rgba(255,255,255,0.06)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function MemoryBrain({ memory, onSelect, spinning = true, className }: MemoryBrainProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // Keep the latest onSelect without re-running the heavy effect on each render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Live spin toggle read inside the rAF — kept in a ref so flipping it never rebuilds
  // the scene (effect deps stay [memory, reduced]).
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── jsdom / no-WebGL fallback: a static "memory map" placeholder, no throw.
    // Probe a throwaway canvas first (mirrors NeuralField's null-GL guard).
    const probe = document.createElement("canvas");
    const supportsGL = !!(
      probe.getContext("webgl") || probe.getContext("experimental-webgl")
    );
    if (!supportsGL) {
      const fallback = document.createElement("div");
      fallback.setAttribute("data-memory-brain-fallback", "true");
      fallback.style.position = "absolute";
      fallback.style.inset = "0";
      fallback.style.display = "grid";
      fallback.style.placeItems = "center";
      fallback.style.overflow = "hidden";
      fallback.style.background =
        "radial-gradient(circle at 50% 42%, rgba(92,242,255,0.12), transparent 60%)," +
        "radial-gradient(circle, rgba(159,198,212,0.10) 1px, transparent 1px) 0 0 / 26px 26px";
      const tag = document.createElement("div");
      tag.textContent = "memory map";
      tag.style.font = "11px system-ui, sans-serif";
      tag.style.letterSpacing = "0.18em";
      tag.style.textTransform = "uppercase";
      tag.style.color = "rgba(215,251,255,0.45)";
      fallback.appendChild(tag);
      container.appendChild(fallback);
      return () => {
        if (fallback.parentElement === container) container.removeChild(fallback);
      };
    }

    // ── scene / camera / renderer ──────────────────────────────────────────────
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 1, 5000);
    const CAM_MIN = 200;
    const CAM_MAX = 1100;
    let camDist = 440; // closer default — the network fills the stage with presence
    camera.position.set(0, 0, camDist);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none"; // we own drag + wheel
    container.appendChild(canvas);

    // The whole graph lives under one group we rotate (drag + idle spin).
    const group = new THREE.Group();
    // Aspect-aware spread: the wide horizontal stretch is desktop-tuned; on a
    // portrait canvas it shoved the graph past the side edges (sparse, clipped).
    // Derived from the canvas aspect at setup AND on every resize.
    const applyGroupScale = () => {
      // Landscape keeps the wide cinematic spread but with enough vertical body
      // that the network fills the tall stage instead of banding across its middle.
      if (camera.aspect >= 1) group.scale.set(2.15, 0.85, 1);
      else group.scale.set(1.15, 1.05, 1); // portrait — near-uniform so it fits the frame
    };
    applyGroupScale();
    scene.add(group);

    // ── build geometry ─────────────────────────────────────────────────────────
    const { nodes, edges } = buildGraph(memory);
    const count = nodes.length;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count); // per-node phase for the twinkle
    const baseSizes = new Float32Array(count); // immutable copy for hover bump
    for (let i = 0; i < count; i++) {
      const n = nodes[i]!;
      positions[i * 3] = n.pos.x;
      positions[i * 3 + 1] = n.pos.y;
      positions[i * 3 + 2] = n.pos.z;
      const dimK = n.dim ? 0.4 : 1;
      colors[i * 3] = n.color.r * dimK;
      colors[i * 3 + 1] = n.color.g * dimK;
      colors[i * 3 + 2] = n.color.b * dimK;
      sizes[i] = n.size;
      seeds[i] = hash01(i * 524287 + 7);
      baseSizes[i] = n.size;
    }

    const sprite = makeSpriteTexture();
    const haloSprite = makeHaloTexture();
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pointsGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    pointsGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    // Shared chunks: per-node decorrelated twinkle (replaces the old global pulse
    // where every node breathed in unison) + a view-depth fade so far nodes recede
    // into the dark instead of flattening the composition.
    const POINT_VERTEX = `
      attribute float size;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vDepth;
      uniform float uTime;
      uniform float uScale;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        float tw = 1.0 + 0.07 * sin(uTime * 1.6 + aSeed * 6.2831);
        // size attenuation: shrink with distance, scale by DPR + twinkle.
        float s = min(size * uScale, 86.0);
        gl_PointSize = s * tw * uPixelRatio * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `;
    const POINT_FRAGMENT = `
      uniform sampler2D uTex;
      uniform float uAlpha;
      uniform float uCamDist;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        if (t.a < 0.02) discard;
        float fade = smoothstep(uCamDist + 320.0, uCamDist - 160.0, vDepth);
        float a = t.a * uAlpha * mix(0.52, 1.0, fade);
        gl_FragColor = vec4(vColor, 1.0) * a;
      }
    `;

    // ShaderMaterial so per-vertex `size` is honored (PointsMaterial ignores it).
    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: sprite },
        uTime: { value: 0 },
        uScale: { value: 1 },
        uAlpha: { value: 1 },
        uCamDist: { value: camDist },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // Corona layer: SAME geometry drawn a second time, wide + soft + faint — every
    // node gets a luminous halo for ~zero extra memory (one extra draw call).
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: haloSprite },
        uTime: { value: 0 },
        uScale: { value: 3.0 },
        uAlpha: { value: 0.5 },
        uCamDist: { value: camDist },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const halos = new THREE.Points(pointsGeo, haloMat);
    halos.renderOrder = 1;
    group.add(halos);
    const points = new THREE.Points(pointsGeo, pointsMat);
    points.renderOrder = 2;
    group.add(points);

    // ── edges: CURVED dendrites with NEURON LIGHT PULSES ─────────────────────────
    // Every edge is a quadratic bézier sampled into CURVE_SEG line segments (one
    // LineSegments draw call total). The control point bows the curve outward from
    // the core plus a deterministic sideways arc, so connections read as organic
    // dendrites instead of straight spokes. A bright band travels 0→1 along each
    // curve (per-edge phase from aSeed); aTint colors the band toward the hub's
    // hue; aKind dims the cross-link web below the primary spokes.
    const segPerEdge = CURVE_SEG;
    const vertsPerEdge = segPerEdge * 2;
    const linePos = new Float32Array(edges.length * vertsPerEdge * 3);
    const lineProgress = new Float32Array(edges.length * vertsPerEdge);
    const lineSeed = new Float32Array(edges.length * vertsPerEdge);
    const lineKind = new Float32Array(edges.length * vertsPerEdge);
    const lineTint = new Float32Array(edges.length * vertsPerEdge * 3);

    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const perp = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const RIGHT = new THREE.Vector3(1, 0, 0);
    const bez = (t: number, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) => {
      const u = 1 - t;
      out.set(
        u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        u * u * a.z + 2 * u * t * c.z + t * t * b.z,
      );
      return out;
    };

    const sample = new THREE.Vector3();
    const samplePrev = new THREE.Vector3();
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e]!;
      va.copy(nodes[edge.a]!.pos);
      vb.copy(nodes[edge.b]!.pos);
      mid.copy(va).add(vb).multiplyScalar(0.5);
      const len = va.distanceTo(vb);
      // Outward bow (away from the core) + a sideways arc, both deterministic.
      dir.copy(vb).sub(va).normalize();
      perp.copy(dir).cross(Math.abs(dir.y) > 0.92 ? RIGHT : UP).normalize();
      const side = (hash01(e * 911 + 29) - 0.5) * 2; // [-1, 1]
      const bowOut = len * (edge.kind === 1 ? 0.16 : 0.1);
      const bowSide = len * 0.16 * side;
      ctrl
        .copy(mid)
        .add(mid.lengthSq() > 1 ? mid.clone().normalize().multiplyScalar(bowOut) : perp.clone().multiplyScalar(bowOut))
        .add(perp.multiplyScalar(bowSide));

      const seed = hash01(e * 2654435761 + 11); // deterministic phase per edge
      bez(0, va, ctrl, vb, samplePrev);
      for (let s = 0; s < segPerEdge; s++) {
        const t0 = s / segPerEdge;
        const t1 = (s + 1) / segPerEdge;
        bez(t1, va, ctrl, vb, sample);
        const vi = (e * segPerEdge + s) * 2;
        linePos[vi * 3] = samplePrev.x;
        linePos[vi * 3 + 1] = samplePrev.y;
        linePos[vi * 3 + 2] = samplePrev.z;
        linePos[vi * 3 + 3] = sample.x;
        linePos[vi * 3 + 4] = sample.y;
        linePos[vi * 3 + 5] = sample.z;
        lineProgress[vi] = t0;
        lineProgress[vi + 1] = t1;
        lineSeed[vi] = seed;
        lineSeed[vi + 1] = seed;
        lineKind[vi] = edge.kind;
        lineKind[vi + 1] = edge.kind;
        lineTint[vi * 3] = edge.tint.r;
        lineTint[vi * 3 + 1] = edge.tint.g;
        lineTint[vi * 3 + 2] = edge.tint.b;
        lineTint[vi * 3 + 3] = edge.tint.r;
        lineTint[vi * 3 + 4] = edge.tint.g;
        lineTint[vi * 3 + 5] = edge.tint.b;
        samplePrev.copy(sample);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute("aProgress", new THREE.BufferAttribute(lineProgress, 1));
    lineGeo.setAttribute("aSeed", new THREE.BufferAttribute(lineSeed, 1));
    lineGeo.setAttribute("aKind", new THREE.BufferAttribute(lineKind, 1));
    lineGeo.setAttribute("aTint", new THREE.BufferAttribute(lineTint, 3));

    // uPulseOn = 0 freezes the travelling band (reduced motion) → faint static lines.
    const lineMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.32 }, // pulse cycles per second along an edge
        uPulseOn: { value: reduced ? 0 : 1 },
        uCamDist: { value: camDist },
        uBase: { value: new THREE.Color("#5cf2ff") }, // resting filament
        uPulseColor: { value: new THREE.Color("#dffaff") }, // bright near-white-cyan band
      },
      vertexShader: `
        attribute float aProgress;
        attribute float aSeed;
        attribute float aKind;
        attribute vec3 aTint;
        varying float vProgress;
        varying float vSeed;
        varying float vKind;
        varying vec3 vTint;
        varying float vDepth;
        void main() {
          vProgress = aProgress;
          vSeed = aSeed;
          vKind = aKind;
          vTint = aTint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uPulseOn;
        uniform float uCamDist;
        uniform vec3 uBase;
        uniform vec3 uPulseColor;
        varying float vProgress;
        varying float vSeed;
        varying float vKind;
        varying vec3 vTint;
        varying float vDepth;
        void main() {
          // Resting filament: primary spokes glow a readable hub-tinted cyan; the
          // cross-link web sits far dimmer so structure stays legible. (Additive —
          // brightness ≈ col * alpha.)
          float strength = mix(1.0, 0.32, vKind);
          vec3 base = mix(uBase, vTint, 0.45) * 0.75 * strength;
          // Pulse head position in [0,1), per-edge phase from the seed; flows 0→1.
          // The web pulses slower + weaker than the spokes.
          float speed = uSpeed * mix(1.0, 0.55, vKind);
          float p = fract(uTime * speed + vSeed);
          // Wrapped distance from this fragment's progress to the pulse head so the
          // band crosses the 0/1 seam seamlessly.
          float d = vProgress - p;
          d = d - floor(d + 0.5); // wrap into [-0.5, 0.5]
          // Narrow gaussian → a tight bright travelling band, tinted toward the hub.
          float pulse = exp(-(d * d) / (2.0 * 0.018 * 0.018)) * uPulseOn * mix(1.0, 0.35, vKind);
          vec3 col = base + mix(uPulseColor, vTint, 0.35) * pulse;
          // View-depth fade: far filaments recede instead of flattening the image.
          float fade = smoothstep(uCamDist + 320.0, uCamDist - 160.0, vDepth);
          float a = (0.6 * strength + pulse * 0.4) * mix(0.45, 1.0, fade);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.renderOrder = 0;
    group.add(lines);

    // ── neural dust: a sparse twinkling particle shell around the graph ──────────
    // Pure atmosphere (not pickable, not labelled): tiny mercury/cyan motes drifting
    // with the same rotation, fading in and out of the dark. One draw call.
    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustSeed = new Float32Array(DUST_COUNT);
    const dustSize = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      // Deterministic shell placement: radius 230..520, uniform-ish direction.
      const u = hash01(i * 37 + 1) * 2 - 1;
      const phi = hash01(i * 101 + 9) * Math.PI * 2;
      const r = 230 + hash01(i * 211 + 3) * 290;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      dustPos[i * 3] = Math.cos(phi) * ring * r;
      dustPos[i * 3 + 1] = u * r;
      dustPos[i * 3 + 2] = Math.sin(phi) * ring * r;
      dustSeed[i] = hash01(i * 587 + 13);
      dustSize[i] = 2 + hash01(i * 769 + 5) * 3.5;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(dustSeed, 1));
    dustGeo.setAttribute("size", new THREE.BufferAttribute(dustSize, 1));
    const dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: sprite },
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float size;
        attribute float aSeed;
        varying float vTwinkle;
        uniform float uTime;
        uniform float uPixelRatio;
        void main() {
          vTwinkle = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 6.2831);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        varying float vTwinkle;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.02) discard;
          float a = t.a * (0.07 + 0.16 * vTwinkle);
          gl_FragColor = vec4(0.62, 0.84, 0.92, 1.0) * a;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.renderOrder = 0;
    group.add(dust);

    // ── HTML LABEL OVERLAY (imperative — never React setState per frame) ─────────
    // One non-interactive overlay holds: a PERSISTENT label per hub + the core
    // (their category name, faded in by camera proximity), and ONE shared HOVER
    // label (the reveal of whatever node the pointer is over). Every frame we
    // project each label's world position to screen pixels and mutate its
    // transform/opacity directly — no React state churn at 60fps. The whole layer
    // lives inside this GL branch, so the null-WebGL fallback never builds it.
    const overlay = document.createElement("div");
    overlay.setAttribute("data-memory-brain-labels", "true");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.overflow = "hidden";
    overlay.style.pointerEvents = "none";
    container.appendChild(overlay);

    // A persistent hub/core label: cyan .hud uppercase, soft glow, projected each
    // frame. We mutate only transform + opacity in the loop.
    function makeHudLabel(text: string): HTMLDivElement {
      const el = document.createElement("div");
      el.className = "hud";
      el.textContent = text;
      el.style.position = "absolute";
      el.style.top = "0";
      el.style.left = "0";
      el.style.whiteSpace = "nowrap";
      el.style.fontSize = "11px";
      el.style.fontWeight = "500";
      el.style.color = "#d7fbff";
      el.style.textShadow = "0 0 10px rgba(92,242,255,0.65), 0 0 2px rgba(92,242,255,0.9)";
      el.style.opacity = "0";
      el.style.willChange = "transform, opacity";
      // translate(-50%,…) centres horizontally over the dot; the loop fills in the
      // pixel offset + a small proximity-driven rise/scale.
      el.style.transform = "translate(-50%,-50%)";
      overlay.appendChild(el);
      return el;
    }

    // Build persistent labels for the core + every category hub (NOT leaves).
    interface HudLabel {
      el: HTMLDivElement;
      idx: number; // node index it tracks
    }
    const hudLabels: HudLabel[] = [];
    for (let i = 0; i < count; i++) {
      const n = nodes[i]!;
      if (n.kind === "core" || n.kind === "category") {
        hudLabels.push({ el: makeHudLabel(n.label), idx: i });
      }
    }

    // The single hover-reveal label (a sleeker, brighter card-less chip): the node
    // label for hubs/core, the truncated memory text for leaves. Fades + rises in.
    const hoverLabel = document.createElement("div");
    hoverLabel.setAttribute("data-memory-brain-hover", "true");
    hoverLabel.style.position = "absolute";
    hoverLabel.style.top = "0";
    hoverLabel.style.left = "0";
    hoverLabel.style.maxWidth = "240px";
    hoverLabel.style.padding = "6px 10px";
    hoverLabel.style.borderRadius = "7px";
    hoverLabel.style.fontSize = "11.5px";
    hoverLabel.style.lineHeight = "1.4";
    hoverLabel.style.color = "#eaf9ff";
    hoverLabel.style.background = "rgba(8,12,18,0.72)";
    hoverLabel.style.border = "1px solid rgba(92,242,255,0.35)";
    hoverLabel.style.boxShadow = "0 0 18px -6px rgba(92,242,255,0.5)";
    hoverLabel.style.backdropFilter = "blur(6px)";
    (hoverLabel.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter =
      "blur(6px)";
    hoverLabel.style.whiteSpace = "normal";
    hoverLabel.style.opacity = "0";
    hoverLabel.style.pointerEvents = "none";
    hoverLabel.style.willChange = "transform, opacity";
    hoverLabel.style.transition = reduced
      ? "opacity 120ms linear"
      : "opacity 180ms ease, transform 180ms cubic-bezier(0.22,1,0.36,1)";
    overlay.appendChild(hoverLabel);

    // Reusable projection scratch (avoid per-frame allocation).
    const projV = new THREE.Vector3();

    /**
     * Project all labels to screen each frame and mutate transform/opacity in
     * place. Persistent hub labels fade in by CLOSENESS to the camera; the hover
     * label tracks the hovered node and reveals its text.
     */
    const updateLabels = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      // Camera distance bounds for the proximity fade (nearer hubs → brighter).
      // Hubs sit on a ~170u shell; with camDist 200–1100, near≈camDist−190,
      // far≈camDist+120 brackets the front-to-back spread sensibly.
      const near = camDist - 190;
      const far = camDist + 130;

      for (const lab of hudLabels) {
        const n = nodes[lab.idx]!;
        projV.copy(n.pos).applyMatrix4(group.matrixWorld);
        const camZ = -projV.clone().applyMatrix4(camera.matrixWorldInverse).z; // view depth
        projV.project(camera);
        // Behind the camera or off-screen → hide.
        const onScreen = projV.z < 1 && projV.x > -1.2 && projV.x < 1.2 && projV.y > -1.2 && projV.y < 1.2;
        // Closeness 0 (far) → 1 (near), smoothed.
        const tt = (far - camZ) / Math.max(1, far - near);
        const close = Math.max(0, Math.min(1, tt));
        const eased = close * close * (3 - 2 * close); // smoothstep
        const px = (projV.x * 0.5 + 0.5) * w;
        const py = (-projV.y * 0.5 + 0.5) * h;
        // Core label always reads a touch stronger so the centre is anchored.
        const floor = n.kind === "core" ? 0.18 : 0.0;
        const op = onScreen ? Math.max(floor, eased) : 0;
        // Slight rise + scale as it nears (skipped under reduced motion).
        const rise = reduced ? 0 : (1 - eased) * 6;
        const scale = reduced ? 1 : 0.92 + eased * 0.12;
        lab.el.style.opacity = op.toFixed(3);
        lab.el.style.transform = `translate(-50%,-50%) translate(${px.toFixed(1)}px, ${(py - 18 + rise).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      }

      // Hover reveal — position over the hovered node, fade/rise in; else hide.
      if (hovered >= 0) {
        const n = nodes[hovered]!;
        projV.copy(n.pos).applyMatrix4(group.matrixWorld).project(camera);
        const onScreen = projV.z < 1;
        const px = (projV.x * 0.5 + 0.5) * w;
        const py = (-projV.y * 0.5 + 0.5) * h;
        hoverLabel.style.opacity = onScreen ? "1" : "0";
        // Anchor just above the node; bottom-centred so the card grows upward.
        hoverLabel.style.transform = `translate(-50%,-100%) translate(${px.toFixed(1)}px, ${(py - 16).toFixed(1)}px)`;
      } else {
        hoverLabel.style.opacity = "0";
      }
    }

    /** Fill the hover label's text for a node (hub/core → label; leaf → text). */
    function setHoverLabelContent(idx: number) {
      if (idx < 0) return;
      const n = nodes[idx]!;
      const isHubOrCore = n.kind === "core" || n.kind === "category";
      hoverLabel.textContent = isHubOrCore ? n.label : truncate(n.text || n.label, 90);
    }

    // ── interaction state ──────────────────────────────────────────────────────
    // Drag → target rotation; the rAF lerps current → target for smoothness.
    const rot = { x: 0, y: 0 };
    const rotTarget = { x: 0, y: 0 };
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    // Two-pointer pinch-to-zoom (touch): the pinch distance delta drives the
    // SAME camDist the wheel uses. Active pointers tracked across down/move/up.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const raycaster = new THREE.Raycaster();
    // Points need an explicit pick threshold (world units near the points).
    raycaster.params.Points = { threshold: 14 };
    const ndc = new THREE.Vector2();
    let hovered = -1;

    function setHover(idx: number) {
      if (idx === hovered) return;
      const sizeAttr = pointsGeo.getAttribute("size") as THREE.BufferAttribute;
      if (hovered >= 0) sizeAttr.setX(hovered, baseSizes[hovered]!);
      if (idx >= 0) sizeAttr.setX(idx, baseSizes[idx]! * 1.6);
      sizeAttr.needsUpdate = true;
      hovered = idx;
      // Refresh the hover-reveal label's text now (position is updated per-frame).
      if (idx >= 0) setHoverLabelContent(idx);
      canvas.style.cursor = idx >= 0 ? "pointer" : "grab";
    }

    function pick(clientX: number, clientY: number): number {
      const r = canvas.getBoundingClientRect();
      ndc.x = ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      ndc.y = -((clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(points, false);
      if (hits.length === 0) return -1;
      // intersectObject returns nearest-first; take the first with an index.
      const idx = hits[0]!.index;
      return idx == null ? -1 : idx;
    }

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // Second finger down: the gesture becomes a pinch — stop rotating and
        // make sure releasing it never reads as a tap.
        dragging = false;
        moved = 1000;
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      } else {
        dragging = true;
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
      }
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // Pinch: distance delta → camDist, clamped exactly like the wheel zoom.
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist > 0) camDist = Math.max(CAM_MIN, Math.min(CAM_MAX, camDist - (d - pinchDist) * 1.2));
        pinchDist = d;
        requestRender(); // reduced-motion: repaint the zoom
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        rotTarget.y += dx * 0.005;
        rotTarget.x += dy * 0.005;
        // clamp vertical tumble so it never flips upside-down
        rotTarget.x = Math.max(-1.2, Math.min(1.2, rotTarget.x));
        requestRender(); // reduced-motion: repaint the drag
      } else {
        setHover(pick(e.clientX, e.clientY));
        requestRender(); // reduced-motion: repaint hover reveal / size bump
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (pointers.size === 1) {
        // Pinch ended with one finger still down — hand off to a drag from
        // where that finger sits, so the graph doesn't jump.
        pinchDist = 0;
        const [p] = [...pointers.values()];
        dragging = true;
        lastX = p!.x;
        lastY = p!.y;
        return;
      }
      pinchDist = 0;
      const wasDrag = moved > 6;
      dragging = false;
      canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
      requestRender(); // reduced-motion: settle the final drag/zoom frame
      // A tap (not a drag) selects whatever node is under the pointer (or null).
      if (!wasDrag) {
        const idx = pick(e.clientX, e.clientY);
        const node = idx >= 0 ? nodes[idx]! : null;
        onSelectRef.current?.(
          node
            ? {
                id: node.id,
                kind: node.kind,
                label: node.label,
                text: node.text,
                category: node.category,
                confidence: node.confidence,
                date: node.date,
              }
            : null,
        );
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camDist = Math.max(CAM_MIN, Math.min(CAM_MAX, camDist + e.deltaY * 0.5));
      requestRender(); // reduced-motion: repaint the zoom (+ proximity label fade)
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyGroupScale(); // re-derive the spread when orientation/aspect changes
      renderer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      pointsMat.uniforms.uPixelRatio!.value = pr;
      haloMat.uniforms.uPixelRatio!.value = pr;
      dustMat.uniforms.uPixelRatio!.value = pr;
      requestRender(); // reduced-motion: repaint after a layout change
    };
    window.addEventListener("resize", resize);

    // ── render loop ────────────────────────────────────────────────────────────
    let frameId = 0;
    const start = performance.now();
    const renderOnce = (now: number) => {
      // Smooth toward the drag target while animating; under reduced motion we
      // render single frames on interaction, so snap straight to target instead.
      if (reduced) {
        rot.x = rotTarget.x;
        rot.y = rotTarget.y;
      } else {
        rot.x += (rotTarget.x - rot.x) * 0.12;
        rot.y += (rotTarget.y - rot.y) * 0.12;
        if (spinningRef.current) rotTarget.y += 0.0016; // gentle idle Y spin (toggleable)
      }
      group.rotation.x = rot.x;
      group.rotation.y = rot.y;
      // shader clocks: edge pulses, node twinkle, dust drift + a whisper of roll
      if (!reduced) {
        const t = (now - start) / 1000;
        lineMat.uniforms.uTime!.value = t;
        pointsMat.uniforms.uTime!.value = t;
        haloMat.uniforms.uTime!.value = t;
        dustMat.uniforms.uTime!.value = t;
        group.rotation.z = Math.sin(t * 0.07) * 0.015; // barely-there sway — feels alive
      }
      // Depth-fade anchor follows the zoom so the fade band stays centred on the graph.
      lineMat.uniforms.uCamDist!.value = camDist;
      pointsMat.uniforms.uCamDist!.value = camDist;
      haloMat.uniforms.uCamDist!.value = camDist;
      camera.position.set(0, 0, camDist);
      camera.lookAt(0, 0, 0);
      // Keep the camera matrices current BEFORE we project labels to screen.
      camera.updateMatrixWorld();
      updateLabels();
      renderer.render(scene, camera);
    };

    const tick = (now: number) => {
      renderOnce(now);
      frameId = requestAnimationFrame(tick);
    };

    // Under reduced motion there's no rAF loop, so interaction (drag / zoom / hover)
    // must repaint on demand — a single coalesced frame per event. This is purely
    // interaction-driven (no autonomous motion), so the labels still position +
    // fade by proximity exactly as specified for reduced motion.
    let reducedFrame = 0;
    const requestRender = () => {
      if (!reduced || reducedFrame) return;
      reducedFrame = requestAnimationFrame(() => {
        reducedFrame = 0;
        renderOnce(performance.now());
      });
    };

    if (reduced) {
      renderOnce(start); // initial static frame; subsequent frames are on-demand
    } else {
      frameId = requestAnimationFrame(tick);
    }

    // ── cleanup ────────────────────────────────────────────────────────────────
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      if (reducedFrame) cancelAnimationFrame(reducedFrame);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      pointsGeo.dispose(); // shared by the node + halo layers
      pointsMat.dispose();
      haloMat.dispose();
      lineGeo.dispose(); // also frees aProgress / aSeed / aKind / aTint
      lineMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      sprite.dispose();
      haloSprite.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentElement === container) container.removeChild(canvas);
      // Tear down the imperative label overlay (and all hub/hover label children).
      if (overlay.parentElement === container) container.removeChild(overlay);
    };
  }, [memory, reduced]);

  const style: CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  return <div ref={containerRef} className={className} style={style} />;
}
