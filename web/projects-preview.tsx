// Scratch preview of the real Projects screen with sample data (not part of the app; do not commit).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./src/theme.css";
import { startDesignRuntime } from "./src/design/look.js";
import { ProjectsScreen } from "./src/projects/ProjectsScreen.js";

startDesignRuntime();
localStorage.setItem("ava.token", "preview");
const now = Date.now(), DAY = 86_400_000;
const p = (over: Record<string, unknown>) => ({ goal: "", folderId: "f", sessionId: "s", version: 1, createdAt: now - 20 * DAY, updatedAt: now - 2 * DAY, removedAt: null, status: "active", ...over });
const projects = [
  p({ id: "tyre", name: "Mobile tyre fitting", kind: "business", stage: "Finding a van", summary: "Comparing complete van equipment packages and looking for a large van in Ireland for €10,000–€15,000.", nextStep: "Shortlist 3 vans with the rear space measured" }),
  p({ id: "ava", name: "AVA", kind: "build", stage: "Memory, then speed", summary: "Finish the speed work, then improve memory before other improvements.", nextStep: "", updatedAt: now }),
  p({ id: "agile", name: "Agile Development", kind: "uni", stage: "", summary: "", nextStep: "", updatedAt: now - 5 * DAY }),
];
const item = (id: string, kind: string, text: string, extra: Record<string, unknown> = {}) => ({ id, projectId: "tyre", kind, text, doneAt: null, source: "voice", createdAt: now - DAY, ...extra });
const detail = (id: string) => ({
  project: projects.find((x) => x.id === id),
  steps: id === "tyre" ? [item("s1", "step", "Decide: complete package or separate equipment", { doneAt: now - 3 * DAY }), item("s2", "step", "Get quotes from 2 equipment suppliers"), item("s3", "step", "Check insurance for mobile fitting")] : [],
  questions: id === "tyre" ? [item("q1", "question", "Which areas of Dublin first, and is Carlow worth covering?")] : [],
  log: [item("l1", "log", "Stage: Finding a van.", { createdAt: now - 2 * DAY }), item("l2", "log", "Project started.", { source: "app", createdAt: now - 20 * DAY })],
  materials: id === "tyre" ? [{ id: "m1", projectId: "tyre", kind: "photo", title: "Transit Custom listing", url: null, fileName: "van.png", mime: "image/png", size: 1, status: "ready", takeaways: "- Price €12,000, 2019, 98k km\n- Load length 2.6 m: too short for changer plus balancer", createdAt: now }, { id: "m2", projectId: "tyre", kind: "link", title: "Complete mobile tyre van package", url: "https://example.com/package", fileName: null, mime: null, size: null, status: "ready", takeaways: "- €6,900 for changer, balancer and compressor\n- Needs 230 V: inverter or generator", createdAt: now }, { id: "m3", projectId: "tyre", kind: "file", title: "Supplier price list", url: null, fileName: "list.pdf", mime: "application/pdf", size: 1, status: "pending", takeaways: "", createdAt: now }] : [],
  notes: id === "agile" ? [{ id: "n1", title: "Lecture 4: Scrum roles", content: "", updatedAt: now - DAY }] : [],
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "/api/projects") return json({ projects, removed: [], fetchedAt: now });
  const conv = url.match(/\/api\/projects\/(\w+)\/conversation/);
  if (conv) return json({ sessionId: "s", messages: conv[1] === "tyre" ? [
    { id: 1, role: "assistant", content: "You were down to vans. Did you find one that fits the balancer without a custom fit-out?", createdAt: now },
    { id: 2, role: "user", content: "Found a Transit for 12k, rear is about 3.3 m.", createdAt: now },
    { id: 3, role: "assistant", content: "That's enough for a machine and balancer side by side. I added it to the project. Want me to ask the seller about the roof height?", createdAt: now },
  ] : [] });
  const one = url.match(/\/api\/projects\/(\w+)$/);
  if (one) return json(detail(one[1]!));
  return json({});
};
createRoot(document.getElementById("root")!).render(<StrictMode><ProjectsScreen /></StrictMode>);
