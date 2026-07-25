#!/usr/bin/env node
/**
 * Explorer reality check — does the declared map still match the machine?
 *
 * The existing contract validator compares the hand-written web registry to the
 * hand-written server registry, and `validateExplorerRegistry()` checks the
 * registry against itself. Neither ever looks at `server/src`. That is how six
 * dead symbols and three dead API routes stayed green in CI while the Atlas
 * rendered them as authoritative source references.
 *
 * This script looks out of the window:
 *
 *   1. SYMBOLS  every `sourceReferences` entry must resolve — the file exists
 *               and the named symbol is actually defined in it.
 *   2. TOOLS    every declared `runtime.toolNames` must be a real tool name
 *               registered somewhere in server/src, and — in the other
 *               direction — every real tool must be declared by some
 *               capability. Undeclared tools are how `read_logs` became
 *               invisible to the capability inspector.
 *   3. ROUTES   every declared `runtime.apiRoutes` must exist as a route in
 *               server/src/routes, accounting for its mount prefix.
 *
 * It also EMITS a verified manifest (`--emit`) so the interface can render
 * evidence that was checked rather than evidence that was typed. A green tick
 * should be earned.
 *
 *   node scripts/explorer-reality-check.mjs           report + exit code
 *   node scripts/explorer-reality-check.mjs --emit    also write the manifest
 *   node scripts/explorer-reality-check.mjs --json    machine-readable output
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "web/src/explorer/verified-manifest.json");

const args = new Set(process.argv.slice(2));
const EMIT = args.has("--emit");
const JSON_OUT = args.has("--json");

// --- helpers -----------------------------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(full)) out.push(full);
  }
  return out;
}

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** A single JS identifier — the only kind of symbol we can check mechanically. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Is one identifier actually defined in this source text?
 *
 * Generous about HOW it is declared (function, const, class, type, re-export)
 * and about tool names, which appear as a `name: "x"` field in a ToolDef rather
 * than as a declaration. Strict about the name itself: the failure being hunted
 * is a rename, where the name is simply gone.
 */
function definesIdentifier(text, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    `\\b(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${s}\\b`,
    `\\b(?:export\\s+)?(?:const|let|var)\\s+${s}\\b`,
    `\\b(?:export\\s+)?(?:abstract\\s+)?class\\s+${s}\\b`,
    `\\b(?:export\\s+)?(?:type|interface|enum)\\s+${s}\\b`,
    `\\bexport\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`,
    `\\bexport\\s+default\\s+${s}\\b`,
    // Tool names live in a ToolDef field, not a declaration.
    `\\bname:\\s*"${s}"`,
  ];
  return patterns.some((p) => new RegExp(p).test(text));
}

/**
 * Verify a `sourceReferences` entry.
 *
 * Many entries use a PROSE LABEL as the symbol ("memory store", "watch
 * scheduler", "Voice pipeline") rather than an identifier. Those are
 * descriptions of what the file is for, and no mechanical check can hold them
 * to more than "the file exists" — claiming otherwise would make this script
 * overclaim in exactly the way it exists to prevent. Only identifier-shaped
 * symbols are held to actually being defined.
 *
 * Returns "verified" | "unverifiable" | "missing".
 */
function checkReference(text, symbol, kind) {
  if (kind === "documentation") {
    return text.includes(symbol) ? "verified" : "unverifiable";
  }
  // "listPeople/upsertPerson" names two identifiers.
  const parts = symbol.split("/").map((p) => p.trim());
  if (parts.every((p) => IDENTIFIER.test(p))) {
    // In a TEST file the symbol names the thing UNDER test — imported and
    // exercised, not declared. Requiring a declaration there would flag every
    // correct test reference in the registry.
    const present = kind === "test"
      ? (p) => new RegExp(`\\b${p}\\b`).test(text)
      : (p) => definesIdentifier(text, p);
    return parts.every(present) ? "verified" : "missing";
  }
  // A prose label: the file exists (checked by the caller), the label does not
  // name anything the compiler knows about.
  return "unverifiable";
}

// --- load the registry -------------------------------------------------------

async function loadRegistry() {
  // The registry is TypeScript; prefer the compiled web output when present,
  // otherwise ask the caller to build. Reading the .ts by regex would be a
  // second hand-written model of the same data — the exact mistake this script
  // exists to catch.
  const built = join(ROOT, "web/dist/explorer/registry.js");
  if (!existsSync(built)) {
    console.error(
      "web/dist/explorer/registry.js not found.\n" +
      "Build the web workspace first:  node node_modules/typescript/bin/tsc -b web/tsconfig.json",
    );
    process.exit(2);
  }
  return import(pathToFileURL(built).href);
}

// --- checks ------------------------------------------------------------------

function checkSymbols(capabilities) {
  const problems = [];
  const verified = [];
  const unverifiable = [];
  for (const cap of capabilities) {
    for (const ref of cap.definition?.sourceReferences ?? []) {
      const abs = join(ROOT, ref.path);
      const text = read(abs);
      const entry = { capability: cap.id, path: ref.path, symbol: ref.symbol, kind: ref.kind ?? "source" };
      if (text === null) {
        problems.push({ ...entry, kind: "missing_file" });
        continue;
      }
      const verdict = checkReference(text, ref.symbol, ref.kind);
      if (verdict === "missing") problems.push({ ...entry, kind: "missing_symbol" });
      else if (verdict === "verified") verified.push(entry);
      else unverifiable.push(entry);
    }
  }
  return { problems, verified, unverifiable };
}

/** Every `name: "x"` inside a ToolDef-shaped object across the server. */
function discoverRealTools() {
  const found = new Map(); // name -> file
  for (const file of walk(join(ROOT, "server/src"))) {
    if (/\.test\.ts$/.test(file)) continue;
    const text = read(file);
    if (text === null) continue;
    // ToolDefs declare `name:` alongside a description/parameters or handler.
    for (const m of text.matchAll(/name:\s*"([a-z][a-z0-9_]{2,})"/g)) {
      const name = m[1];
      const window = text.slice(m.index, m.index + 600);
      if (!/description:|parameters:|input_schema:|inputSchema:/.test(window)) continue;
      if (!found.has(name)) found.set(name, relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  return found;
}

function checkTools(capabilities, realTools) {
  const declared = new Map(); // tool -> [capabilityId]
  for (const cap of capabilities) {
    for (const tool of cap.runtime?.toolNames ?? []) {
      if (!declared.has(tool)) declared.set(tool, []);
      declared.get(tool).push(cap.id);
    }
  }
  const problems = [];
  for (const [tool, caps] of declared) {
    if (!realTools.has(tool)) {
      problems.push({ kind: "declared_tool_missing", tool, capabilities: caps });
    }
  }
  for (const [tool, file] of realTools) {
    if (!declared.has(tool)) {
      problems.push({ kind: "undeclared_tool", tool, file });
    }
  }
  return { problems, declared };
}

/** Route paths the server actually serves, as `mountPrefix + routerPath`. */
function discoverRealRoutes() {
  const routes = new Set();
  const indexText = read(join(ROOT, "server/src/index.ts")) ?? "";

  // Map router module -> mount prefix from `app.use("<prefix>", xRoutes(...))`.
  const mounts = new Map();
  for (const m of indexText.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    mounts.set(m[2], m[1]);
  }

  for (const file of walk(join(ROOT, "server/src/routes"))) {
    if (/\.test\.ts$/.test(file)) continue;
    const text = read(file);
    if (text === null) continue;
    // Which exported factory does this file provide, and where is it mounted?
    const exported = [...text.matchAll(/export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    const prefixes = exported.map((name) => mounts.get(name)).filter((p) => p !== undefined);
    const prefix = prefixes[0] ?? "";
    for (const m of text.matchAll(/\br\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      routes.add(normaliseRoute(prefix, m[2]));
    }
    for (const m of text.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      routes.add(normaliseRoute(prefix, m[2]));
    }
  }
  // Routes registered directly on the app.
  for (const m of indexText.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    routes.add(normaliseRoute("", m[2]));
  }
  return routes;
}

const normaliseRoute = (prefix, path) =>
  `${prefix}${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

function checkRoutes(capabilities, realRoutes) {
  const problems = [];
  const verified = [];
  for (const cap of capabilities) {
    for (const route of cap.runtime?.apiRoutes ?? []) {
      const want = normaliseRoute("", route);
      // A declared route matches if it is served literally, or if a param
      // route covers it (`/api/tasks/:id` serves `/api/tasks/123`).
      const hit = realRoutes.has(want) || [...realRoutes].some((r) => {
        if (!r.includes(":")) return false;
        const rx = new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`);
        return rx.test(want);
      });
      if (hit) verified.push({ capability: cap.id, route: want });
      else problems.push({ kind: "declared_route_missing", capability: cap.id, route: want });
    }
  }
  return { problems, verified };
}

// --- run ---------------------------------------------------------------------

const mod = await loadRegistry();
const capabilities = mod.EXPLORER_CAPABILITIES ?? [];
const domains = mod.EXPLORER_DOMAINS ?? [];

const symbols = checkSymbols(capabilities);
const realTools = discoverRealTools();
const tools = checkTools(capabilities, realTools);
const realRoutes = discoverRealRoutes();
const routes = checkRoutes(capabilities, realRoutes);

const problems = [...symbols.problems, ...tools.problems, ...routes.problems];

if (EMIT) {
  const manifest = {
    generatedAt: Date.now(),
    generator: "scripts/explorer-reality-check.mjs",
    note: "Every entry here was resolved against the real source tree at build time. "
      + "Absence from this manifest means the claim was NOT verified.",
    verifiedSymbols: symbols.verified,
    verifiedRoutes: routes.verified,
    realTools: [...realTools].map(([name, file]) => ({ name, file })),
    undeclaredTools: tools.problems.filter((p) => p.kind === "undeclared_tool").map((p) => p.tool),
    problems,
  };
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ problems, counts: summary() }, null, 2));
} else {
  report();
}

function summary() {
  return {
    capabilities: capabilities.length,
    domains: domains.length,
    sourceReferences: symbols.verified.length + symbols.unverifiable.length + symbols.problems.length,
    verifiedSymbols: symbols.verified.length,
    unverifiable: symbols.unverifiable.length,
    brokenSymbols: symbols.problems.length,
    realTools: realTools.size,
    declaredTools: tools.declared.size,
    declaredRoutes: routes.verified.length + routes.problems.filter((p) => p.kind === "declared_route_missing").length,
    verifiedRoutes: routes.verified.length,
    problems: problems.length,
  };
}

function report() {
  const s = summary();
  const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);
  console.log("\nEXPLORER REALITY CHECK — the declared map against the real machine\n");
  line("domains", s.domains);
  line("capabilities", s.capabilities);
  line("source references", `${s.verifiedSymbols} verified · ${s.unverifiable} prose labels (file only) · ${s.brokenSymbols} broken`);
  line("api routes", `${s.verifiedRoutes}/${s.declaredRoutes} exist`);
  line("tools declared", s.declaredTools);
  line("tools in server/src", s.realTools);

  const byKind = new Map();
  for (const p of problems) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);

  const HEAD = {
    missing_file: "Declared source file does not exist",
    missing_symbol: "Declared symbol is not defined in that file",
    declared_tool_missing: "Declared tool is not registered anywhere in server/src",
    undeclared_tool: "Real tool is declared by NO capability (invisible in Explorer)",
    declared_route_missing: "Declared API route is not served",
  };

  for (const [kind, list] of byKind) {
    console.log(`\n${HEAD[kind] ?? kind} — ${list.length}`);
    for (const p of list) {
      if (kind === "undeclared_tool") console.log(`  ${p.tool.padEnd(28)} ${p.file}`);
      else if (kind === "declared_tool_missing") console.log(`  ${p.tool.padEnd(28)} declared by ${p.capabilities.join(", ")}`);
      else if (kind === "declared_route_missing") console.log(`  ${p.route.padEnd(38)} ${p.capability}`);
      else console.log(`  ${`${p.path} · ${p.symbol}`.padEnd(62)} ${p.capability}`);
    }
  }

  console.log(
    problems.length === 0
      ? "\nThe map matches the machine.\n"
      : `\n${problems.length} claim(s) the map makes that the machine does not support.\n`,
  );
}

process.exit(problems.length === 0 ? 0 : 1);
