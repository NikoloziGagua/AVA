import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Chrome } from "../tools/chrome.js";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import { ensureReady, openChat, sendMessage, readChat } from "./whatsapp.js";

// WhatsApp tools — the deterministic workflows for WhatsApp Web. Every edge
// case returns instructions for what to ask Sir, so the agent never flails:
// needs=qr → ask Sir to scan the QR code in my browser window (WhatsApp Web
// has no password login — a phone scan is the only way in);
// needs=person/username → ask who/what and retry.

type ToolDef = { tool: Tool; run: (args: Record<string, unknown>) => Promise<{
  text: string; ok: boolean; verification?: ToolVerificationEvidence;
}> };

const verified = (method: string, summary: string): ToolVerificationEvidence => ({
  state: "verified",
  scope: "task_outcome",
  method,
  summary,
});

export function buildWhatsappTools(o: { getChrome: () => Promise<Chrome>; memoryDir: string }): ToolDef[] {
  const deps = async () => ({ chrome: await o.getChrome(), memoryDir: o.memoryDir });
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return [
    {
      tool: {
        name: "whatsapp_send_message",
        description:
          "Send a WhatsApp message via WhatsApp Web. person = a name/alias from the " +
          "people map, a WhatsApp display name, or a phone number. Finds the chat via " +
          "the chat-list search, verifies the conversation header before typing, and " +
          "verifies the message appears on the page before claiming success — never " +
          "claim a send that wasn't verified. If it returns needs=qr, ask Sir to scan " +
          "the QR code in my browser window (phone: WhatsApp > Linked devices > Link a " +
          "device); needs=person/username → ask Sir for exactly that and retry.",
        inputSchema: {
          type: "object",
          properties: {
            person: { type: "string", description: "Name, alias, WhatsApp display name, or phone number." },
            text: { type: "string", description: "Message to send, verbatim." },
          },
          required: ["person", "text"],
        },
      },
      run: async (args) => {
        const r = await sendMessage(await deps(), s(args.person), s(args.text));
        return {
          ok: r.ok,
          text: r.detail,
          ...(r.ok ? { verification: verified("whatsapp_message_dom", "The message appeared in the conversation whose header matched the resolved recipient.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "whatsapp_open_chat",
        description: "Open the WhatsApp Web chat with a person (people-map name, display name, or phone number) without sending anything. Verifies the conversation header shows the right person.",
        inputSchema: { type: "object", properties: { person: { type: "string" } }, required: ["person"] },
      },
      run: async (args) => {
        const r = await openChat(await deps(), s(args.person));
        return {
          ok: r.ok,
          text: r.detail,
          ...(r.ok ? { verification: verified("whatsapp_header_identity", "The opened conversation header matched the resolved recipient.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "whatsapp_read_chat",
        description: "Open the WhatsApp chat with a person and return the visible tail of the conversation (for 'what did X reply?').",
        inputSchema: { type: "object", properties: { person: { type: "string" } }, required: ["person"] },
      },
      run: async (args) => {
        const r = await readChat(await deps(), s(args.person));
        return {
          ok: r.ok,
          text: r.ok ? `${r.detail}:\n${r.text ?? ""}` : r.detail,
          ...(r.ok ? { verification: verified("whatsapp_header_identity", "Visible messages were read from the conversation whose header matched the recipient.") } : {}),
        };
      },
    },
    {
      tool: {
        name: "whatsapp_status",
        description:
          "Check the WhatsApp Web connection: linked / QR login screen / still loading " +
          "chats. Use before promising WhatsApp actions. needs=qr means Sir must scan " +
          "the QR in my browser window (phone: WhatsApp > Linked devices).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: async () => {
        const r = await ensureReady(await deps());
        return { ok: r.ok, text: r.detail };
      },
    },
  ];
}
