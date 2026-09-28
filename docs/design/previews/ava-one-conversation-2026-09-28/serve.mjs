// Loopback-only static server for the "One conversation" discussion preview. Read-only, no write endpoints.
// Usage (from the AVA repository root): node docs/design/previews/ava-one-conversation-2026-09-28/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../../..");
const PREVIEW = "/docs/design/previews/ava-one-conversation-2026-09-28/";
// The page reuses the Future hub's shared.css/shared.js and AVA's bundled fonts.
const ALLOWED = [PREVIEW, "/docs/design/previews/ava-future-2026-09-28/shared.", "/web/public/fonts/"];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };
const port = Number(process.argv[2] || 5181);

createServer(async (req, res) => {
  let path;
  // Malformed percent-encoding must not reject the listener and stop the server.
  try { path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); }
  catch { res.writeHead(400); res.end("Bad request"); return; }
  if (path === "/") { res.writeHead(302, { location: PREVIEW + "index.html" }); res.end(); return; }
  if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const target = normalize(join(root, path));
  const rel = "/" + relative(root, target).split(sep).join("/");
  const allowed = !rel.startsWith("/..") && ALLOWED.some((prefix) => rel.startsWith(prefix));
  if (req.method !== "GET" || !allowed) { res.writeHead(404); res.end("Not found"); return; }
  try {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`AVA · One conversation preview: http://127.0.0.1:${port}/`));
