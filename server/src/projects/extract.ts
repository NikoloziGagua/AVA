import { readFileSync } from "node:fs";
import type OpenAI from "openai";
import type { Db } from "../state/db.js";
import { finishMaterial, materialPath, publicUrl, type Material } from "./materials.js";
import { addProjectItem, getProject } from "./store.js";

// When Sir drops something into a project, AVA reads it once and keeps only
// what matters for that project: facts, numbers, prices, decisions, next steps.

const MODEL = "gpt-5.6";
const MAX_TEXT = 12_000;

export function htmlText(html: string): { title: string; text: string } {
  const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ?? "";
  const title = (meta("og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
  const description = meta("og:description") || meta("description");
  return { title: decode(title), text: [description, body].filter(Boolean).join("\n").slice(0, MAX_TEXT) };
}
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");

/** Fetches a public page, following at most three redirects, each checked to stay public. */
export async function fetchPage(url: string, fetcher: typeof fetch = fetch): Promise<{ title: string; text: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!publicUrl(current)) throw new Error("The link points somewhere private.");
    const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0 AVA", accept: "text/html,text/plain,*/*" } });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) { current = new URL(location, current).href; continue; }
    if (!response.ok) throw new Error(`The page answered ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    const raw = (await response.text()).slice(0, 600_000);
    return type.includes("html") ? htmlText(raw) : { title: "", text: raw.slice(0, MAX_TEXT) };
  }
  throw new Error("Too many redirects.");
}

function prompt(projectName: string, projectSummary: string, what: string): string {
  return `This is for Sir's project “${projectName}”${projectSummary ? ` (where it stands: ${projectSummary})` : ""}.
From this ${what}, pull out only what matters for the project: facts, numbers, prices, specs, decisions, risks and next steps.
Reply in this exact form:
Title: a short name for it, at most 8 words
- 2 to 5 short lines, each a concrete point
If nothing in it is useful for the project, write one line saying what it is.`;
}

export function parseTakeaways(raw: string): { title: string; takeaways: string } {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const titleLine = lines.find((line) => /^title:/i.test(line));
  const points = lines.filter((line) => line !== titleLine).map((line) => line.replace(/^[-*•]\s*/, "- ")).slice(0, 6);
  return { title: titleLine?.replace(/^title:\s*/i, "").slice(0, 120) ?? "", takeaways: points.join("\n") };
}

type Part = OpenAI.Chat.ChatCompletionContentPart;

async function ask(openai: OpenAI, content: Part[]): Promise<string> {
  const messages = [{ role: "user" as const, content }];
  let response: OpenAI.Chat.ChatCompletion;
  try {
    response = await openai.chat.completions.create({ model: MODEL, messages, max_completion_tokens: 2_000, reasoning_effort: "low" } as Parameters<typeof openai.chat.completions.create>[0]) as OpenAI.Chat.ChatCompletion;
  } catch {
    response = await openai.chat.completions.create({ model: MODEL, messages, max_completion_tokens: 2_000 }) as OpenAI.Chat.ChatCompletion;
  }
  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("AVA couldn't read it.");
  return text;
}

/** Reads one material and records what AVA took from it. Never throws: a failure is saved on the material. */
export async function extractMaterial(deps: { db: Db; dataDir: string; openai: OpenAI | null; fetcher?: typeof fetch }, material: Material): Promise<void> {
  const project = getProject(deps.db, material.projectId);
  if (!project) return;
  try {
    if (!deps.openai) throw new Error("AVA's reading model isn't configured.");
    let parts: Part[];
    if (material.kind === "link") {
      const page = await fetchPage(material.url!, deps.fetcher);
      parts = [{ type: "text", text: `${prompt(project.name, project.summary, "web page")}\n\nPage: ${material.url}\nTitle: ${page.title}\n\n${page.text}` }];
    } else {
      const bytes = readFileSync(materialPath(deps.dataDir, material));
      if (material.kind === "photo") {
        parts = [{ type: "text", text: prompt(project.name, project.summary, "photo") }, { type: "image_url", image_url: { url: `data:${material.mime};base64,${bytes.toString("base64")}` } }];
      } else if (material.mime === "application/pdf") {
        parts = [{ type: "text", text: prompt(project.name, project.summary, "document") },
          { type: "file", file: { filename: material.fileName ?? "document.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } } as Part];
      } else {
        parts = [{ type: "text", text: `${prompt(project.name, project.summary, "file")}\n\nFile ${material.fileName}:\n${bytes.toString("utf8").slice(0, MAX_TEXT)}` }];
      }
    }
    const { title, takeaways } = parseTakeaways(await ask(deps.openai, parts));
    const done = finishMaterial(deps.db, material.id, { status: "ready", takeaways, title });
    if (done) addProjectItem(deps.db, project.id, { kind: "log", text: `Added ${done.kind === "link" ? "a link" : done.kind === "photo" ? "a photo" : "a file"}: ${done.title}`, source: material.source });
  } catch (error) {
    finishMaterial(deps.db, material.id, { status: "failed", takeaways: error instanceof Error ? error.message : "AVA couldn't read it." });
  }
}
