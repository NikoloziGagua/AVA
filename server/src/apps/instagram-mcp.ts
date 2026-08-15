import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Chrome } from "../tools/chrome.js";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import { ensureReady, login, submitCode, openProfile, openThread, sendDm, readThread } from "./instagram.js";
import { listPeople, upsertPerson } from "./people.js";

// Instagram + people tools — the deterministic identity path for Sir's most-used
// app. Every edge case returns instructions for what to ask Sir, so the agent
// never flails: needs=login → ask for credentials or a window login;
// needs=code → ask for the 2FA code; needs=person/username → ask who/what.

type ToolDef = { tool: Tool; run: (args: Record<string, unknown>) => Promise<{
  text: string; ok: boolean; verification?: ToolVerificationEvidence;
}> };

const verified = (method: string, summary: string): ToolVerificationEvidence => ({
  state: "verified",
  scope: "task_outcome",
  method,
  summary,
});

export function buildInstagramTools(o: { getChrome: () => Promise<Chrome>; memoryDir: string }): ToolDef[] {
  const deps = async () => ({ chrome: await o.getChrome(), memoryDir: o.memoryDir });
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    {
      tool: {
        name: "instagram_open_profile",
        description:
          "Open an Instagram profile without messaging. A known people-map name or " +
          "explicit @username opens directly. An unknown plain name opens safe search " +
          "results instead of guessing the account; ask for the @username only when an " +
          "exact profile is required.",
        inputSchema: {
          type: "object",
          properties: { person: { type: "string", description: "Known name, plain search name, or @username." } },
          required: ["person"],
        },
      },
      run: async (args) => {
        const r = await openProfile(await deps(), s(args.person));
        return {
          ok: r.ok,
          text: r.detail,
          ...(r.ok ? { verification: verified("instagram_profile_url", "Instagram remained on the exact resolved profile URL.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "instagram_send_dm",
        description:
          "Send an Instagram DM. person = a name/alias from the people map, or a raw " +
          "IG username. Always resolves the exact username, opens instagram.com/<username>/, " +
          "verifies that profile URL, and enters through its exact Message action. It never " +
          "searches the inbox or routes by a learned thread ID. " +
          "Verifies the message appears on the page before claiming success. If it " +
          "returns needs=login/code/person, ask Sir for exactly that and retry.",
        inputSchema: {
          type: "object",
          properties: {
            person: { type: "string", description: "Name, alias, or IG username." },
            text: { type: "string", description: "Message to send, verbatim." },
          },
          required: ["person", "text"],
        },
      },
      run: async (args) => {
        const r = await sendDm(await deps(), s(args.person), s(args.text));
        return {
          ok: r.ok,
          text: r.detail,
          ...(r.ok ? { verification: verified("instagram_message_dom", "The message appeared in the verified recipient conversation and left the composer.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "instagram_open_chat",
        description: "Open the Instagram DM thread with a person without sending: resolve the people-map username, verify the exact profile URL, then click its Message action. Never searches the inbox.",
        inputSchema: { type: "object", properties: { person: { type: "string" } }, required: ["person"] },
      },
      run: async (args) => {
        const r = await openThread(await deps(), s(args.person));
        return {
          ok: r.ok,
          text: r.detail,
          ...(r.ok ? { verification: verified("instagram_thread_identity", "The conversation opened through the exact verified recipient profile.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "instagram_read_chat",
        description: "Open a person's DM through their exact saved Instagram profile and return the visible conversation tail. Never searches the inbox for the recipient.",
        inputSchema: { type: "object", properties: { person: { type: "string" } }, required: ["person"] },
      },
      run: async (args) => {
        const r = await readThread(await deps(), s(args.person));
        return {
          ok: r.ok,
          text: r.ok ? `${r.detail}:\n${r.text ?? ""}` : r.detail,
          ...(r.ok ? { verification: verified("instagram_thread_identity", "Visible messages were read from the exact verified recipient conversation.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "instagram_status",
        description: "Check the Instagram connection: logged in / login wall / 2FA checkpoint. Use before promising Instagram actions.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: async () => {
        const r = await ensureReady(await deps());
        return { ok: r.ok, text: r.detail };
      },
    },
    {
      tool: {
        name: "instagram_login",
        description:
          "Log in to Instagram in MY browser with credentials Sir provides. The password " +
          "is redacted from all logs/streams. On needs=code, ask Sir for the 2FA code and " +
          "call instagram_submit_code. Alternative (no password shared): Sir logs in " +
          "directly in my browser window.",
        inputSchema: {
          type: "object",
          properties: { username: { type: "string" }, password: { type: "string" } },
          required: ["username", "password"],
        },
      },
      run: async (args) => {
        const r = await login(await deps(), { username: s(args.username), password: s(args.password) });
        return { ok: r.ok, text: r.detail };
      },
    },
    {
      tool: {
        name: "instagram_submit_code",
        description: "Submit the 2FA/verification code Sir provided to finish an Instagram login checkpoint.",
        inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      },
      run: async (args) => {
        const r = await submitCode(await deps(), s(args.code));
        return { ok: r.ok, text: r.detail };
      },
    },
  ];
}

export function buildPeopleTools(o: { memoryDir: string }): ToolDef[] {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    {
      tool: {
        name: "person_remember",
        description:
          "Save or update a person in the people map: name, aliases (nicknames Sir uses), " +
          "Instagram username, WhatsApp phone/display name. This is how 'text Lasha' works " +
          "even when Lasha's username is weird_username_123. Update it whenever Sir " +
          "clarifies who someone is.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
            instagram_username: { type: "string" },
            whatsapp_phone: { type: "string" },
            whatsapp_name: { type: "string", description: "Display name in WhatsApp chat list." },
            notes: { type: "string" },
          },
          required: ["name"],
        },
      },
      run: async (args) => {
        const name = s(args.name).trim();
        if (!name) return { ok: false, text: "person_remember needs a name" };
        const p = upsertPerson(o.memoryDir, {
          name,
          aliases: Array.isArray(args.aliases) ? args.aliases.map(String) : undefined,
          instagram: s(args.instagram_username) ? { username: s(args.instagram_username).toLowerCase().replace(/^@/, "") } : undefined,
          whatsapp: s(args.whatsapp_phone) || s(args.whatsapp_name)
            ? { phone: s(args.whatsapp_phone) || undefined, username: s(args.whatsapp_name) || undefined }
            : undefined,
          notes: s(args.notes) || undefined,
        });
        return { ok: true, text: `saved ${p.name}${p.instagram?.username ? ` (IG @${p.instagram.username})` : ""}${p.aliases.length ? ` aliases: ${p.aliases.join(", ")}` : ""}` };
      },
    },
    {
      tool: {
        name: "person_list",
        description: "List everyone in the people map with their known app identities.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: async () => {
        const all = listPeople(o.memoryDir);
        if (!all.length) return { ok: true, text: "people map is empty" };
        return {
          ok: true,
          text: all.map((p) =>
            `${p.name}${p.aliases.length ? ` (${p.aliases.join(", ")})` : ""}` +
            `${p.instagram?.username ? ` | IG @${p.instagram.username}${p.instagram.threadId ? " ✓verified-thread" : ""}` : ""}` +
            `${p.whatsapp?.phone || p.whatsapp?.username ? ` | WA ${p.whatsapp.username ?? p.whatsapp.phone}` : ""}`).join("\n"),
        };
      },
    },
  ];
}
