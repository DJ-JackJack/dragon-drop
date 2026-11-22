/**
 * MCP endpoint (Streamable HTTP, stateless) so Claude Code — including a Remote Control
 * session driven from your phone — can use the same map tools as the in-app chat. `/mcp?tools=essentials` lists the smaller set
 * with short instructions, for smaller models (tools essentials.ts); every tool still answers by name.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ESSENTIAL_INSTRUCTIONS, MAPMAKER_INSTRUCTIONS, type ToolSet, runTool, toolList } from "@mapmaker/tools";
import type { Hub } from "./hub.ts";

function buildServer(hub: Hub, set: ToolSet) {
  const server = new Server(
    { name: "dragon-drop", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: set === "essentials" ? ESSENTIAL_INSTRUCTIONS : MAPMAKER_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolList(set).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await runTool(hub.toolContext("mcp"), req.params.name, req.params.arguments ?? {});
    return {
      content: r.content.map((c) => c.type === "text"
        ? { type: "text" as const, text: c.text }
        : { type: "image" as const, data: c.data, mimeType: c.mediaType }),
      isError: r.isError ?? false,
    };
  });
  return server;
}

export async function handleMcp(hub: Hub, req: IncomingMessage, res: ServerResponse, allowedHosts: string[], allowedOrigins: string[]) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", allow: "POST" }).end(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)" }, id: null }),
    );
    return;
  }
  const body = await readJsonBody(req);
  const set: ToolSet = new URL(req.url ?? "/mcp", "http://localhost").searchParams.get("tools") === "essentials" ? "essentials" : "all";
  const server = buildServer(hub, set);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts,
    allowedOrigins,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 20 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}
