/**
 * PassQR MCP Server — Cloudflare Worker entry point.
 *
 * Exposes a Streamable HTTP MCP endpoint at /mcp.
 * Auth: the PassQR API key travels on the `X-PassQR-API-Key` header
 * and is forwarded as `Authorization: Bearer <key>` to the PassQR v1 API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  PASSQR_API_BASE: string;
  // Only set in .dev.vars for local testing — never in production.
  PASSQR_API_KEY_DEFAULT?: string;
}

/**
 * Extract the PassQR API key from the incoming request.
 * Priority: X-PassQR-API-Key → Authorization: Bearer → env fallback (dev only).
 */
function extractApiKey(request: Request, env: Env): string | null {
  const headerKey = request.headers.get("x-passqr-api-key");
  if (headerKey) return headerKey.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  // Local dev only. In production PASSQR_API_KEY_DEFAULT is never set.
  if (env.PASSQR_API_KEY_DEFAULT) return env.PASSQR_API_KEY_DEFAULT;

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check for uptime monitors.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "passqr-mcp-server",
          version: "0.1.0",
          endpoint: "/mcp",
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname !== "/mcp") {
      return new Response(
        "Not found — MCP endpoint lives at /mcp",
        { status: 404 }
      );
    }

    const apiKey = extractApiKey(request, env);
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "missing_credentials",
          message:
            "Send your PassQR API key as `X-PassQR-API-Key` or `Authorization: Bearer pqr_live_...`.",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        }
      );
    }

    // Fresh MCP server per request — stateless, fine for the v1 surface.
    const server = new McpServer(
      { name: "passqr", version: "0.1.0" },
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

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    return transport.handleFetchRequest(request);
  },
};
