/**
 * PassQR MCP Server — Cloudflare Worker entry point.
 *
 * Uses the official StreamableHTTPServerTransport from @modelcontextprotocol/sdk
 * v1.20+ with a Fetch→Node shim (fetch-to-node) so Workers can speak the full
 * Streamable HTTP spec that Claude.ai requires.
 *
 * Auth resolution:
 *   1. `X-PassQR-API-Key` header
 *   2. `Authorization: Bearer pqr_live_…`
 *   3. Worker secret `PASSQR_API_KEY` (single-tenant fallback for Claude.ai)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  PASSQR_API_BASE: string;
  PASSQR_API_KEY?: string;
  PASSQR_API_KEY_DEFAULT?: string;
}

function extractApiKey(request: Request, env: Env): string | null {
  const headerKey = request.headers.get("x-passqr-api-key");
  if (headerKey) return headerKey.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  if (env.PASSQR_API_KEY) return env.PASSQR_API_KEY;
  if (env.PASSQR_API_KEY_DEFAULT) return env.PASSQR_API_KEY_DEFAULT;
  return null;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
  "access-control-allow-headers":
    "content-type, authorization, x-passqr-api-key, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return corsJson({
        ok: true,
        service: "passqr-mcp-server",
        version: "0.1.2",
        endpoint: "/mcp",
        transport: "streamable-http",
        auth: env.PASSQR_API_KEY ? "secret-fallback-enabled" : "header-required",
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found — MCP endpoint lives at /mcp", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const apiKey = extractApiKey(request, env);
    if (!apiKey) {
      return corsJson(
        {
          error: "missing_credentials",
          message:
            "No API key configured. Send `X-PassQR-API-Key` or set the `PASSQR_API_KEY` Worker secret.",
        },
        401
      );
    }

    // Build a fresh MCP server per request — stateless is fine for our tool surface.
    const server = new McpServer(
      { name: "passqr", version: "0.1.2" },
      {
        capabilities: { tools: {} },
        instructions:
          "Tools for managing PassQR digital passes (tickets, memberships, loyalty cards). " +
          "Call list_templates first when creating passes so you know valid template_id values. " +
          "Treat create_pass, update_pass, revoke_pass, and validate_pass as state-changing — " +
          "confirm with the user before bulk operations.",
      }
    );

    registerAllTools(server, { apiKey, apiBase: env.PASSQR_API_BASE });

    // Adapt Fetch Request → Node req/res so we can use the real transport.
    const { req, res } = toReqRes(request);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true, // allow JSON fallback for non-SSE clients
    });

    // Ensure transport is torn down when the response closes to avoid leaks.
    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);

    try {
      const body =
        request.method === "POST" ? await request.clone().json() : undefined;
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("MCP transport error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: "Internal server error" },
          })
        );
      }
    }

    const response = await toFetchResponse(res);

    // Merge CORS headers onto the SDK's response.
    const merged = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) merged.set(k, v);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    });
  },
};
