// Scratch preview of the real Training screen with data built by the real server code (not part of the app; do not commit).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./src/theme.css";
import { startDesignRuntime } from "./src/design/look.js";
import { TrainingScreen } from "./src/training/TrainingScreen.js";
import data from "./training-live-preview.json";

startDesignRuntime();
localStorage.setItem("ava.token", "preview");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith("/api/training/plan")) return json({ result: data.plan, week: data.week });
  if (url.startsWith("/api/training/ask")) return json({ handled: true, text: "Done, and checked just now: logged Boxing on Tue 6 Oct: 60 min, effort 7. Added as a new session." });
  if (url.startsWith("/api/training")) return json(url === "/api/training" || url.startsWith("/api/training?") ? data.week : {});
  return json({});
};
createRoot(document.getElementById("root")!).render(<StrictMode><TrainingScreen onVoice={() => {}} onAsk={() => {}} /></StrictMode>);
