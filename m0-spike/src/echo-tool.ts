// m0-spike/src/echo-tool.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export function buildEchoServer(): Server {
  const server = new Server(
    { name: "ava-echo", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo a message back. Used to validate the tool loop.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "echo") {
      throw new Error(`unknown tool ${req.params.name}`);
    }
    const message = String((req.params.arguments as { message?: string })?.message ?? "");
    // Simulated work so we can test abort
    await new Promise((r) => setTimeout(r, 200));
    return { content: [{ type: "text", text: message }] };
  });

  return server;
}
