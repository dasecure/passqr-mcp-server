/**
 * PassQR MCP Server — Cloudflare Worker entry point.
 *
 * Exposes an MCP JSON-RPC endpoint at /mcp over plain HTTP POST.
 *
 * Auth resolution order:
 *   1. `X-PassQR-API-Key` header          — multi-tenant / dev clients
 *   2. `Authorization: Bearer pqr_live_…` — multi-tenant / standard clients
 *   3. Worker secret `PASSQR_API_KEY`     — single-tenant fallback (Claude.ai)
 *
 * Claude.ai's custom connectors currently only allow OAuth or no-auth.
 * The secret fallback lets a single owner run a private, pre-keyed server
 * without headers. For multi-user deployments, run without the secret
 * and require the header.
 *
 * Why we don't use StreamableHTTPServerTransport:
 *   v1.0.x of the MCP SDK's transport expects Node req/res pairs.
 *   Workers give us a Fetch Request. Rather than shim one into the other,
 *   we drive the lower-level Server directly — same code path, fewer deps.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  PASSQR_API_BASE: string;
  // Set via `wrangler secret put PASSQR_API_KEY`.
  // When present, acts as the fallback key for requests that arrive
  // without `X-PassQR-API-Key` or `Authorization: Bearer` headers.
  PASSQR_API_KEY?: string;
  // Legacy / dev alias — still honored but prefer PASSQR_API_KEY.
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

// Claude.ai and other MCP hosts may preflight with OPTIONS before POSTing.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-passqr-api-key, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

async function handleJsonRpc(
  mcp: McpServer,
  message: {
    jsonrpc: string;
    id?: number | string;
    method: string;
    params?: unknown;
  }
): Promise<unknown> {
  const underlying = (mcp as unknown as { server: Server }).server;

  const handlers = (underlying as unknown as {
    _requestHandlers: Map<
      string,
      (req: unknown, extra: unknown) => Promise<unknown>
    >;
  })._requestHandlers;

  const handler = handlers.get(message.method);
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: -32601,
        message: `Method not found: ${message.method}`,
      },
    };
  }

  try {
    const result = await handler(
      { method: message.method, params: message.params ?? {} },
      { signal: new AbortController().signal }
    );
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      result,
    };
  } catch (err) {
    const e = err as { code?: number; message?: string };
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: e.code ?? -32603,
        message: e.message ?? String(err),
      },
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "passqr-mcp-server",
        version: "0.1.1",
        endpoint: "/mcp",
        auth: env.PASSQR_API_KEY
          ? "secret-fallback-enabled"
          : "header-required",
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found — MCP endpoint lives at /mcp", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "POST only" },
        405
      );
    }

    const apiKey = extractApiKey(request, env);
    if (!apiKey) {
      return jsonResponse(
        {
          error: "missing_credentials",
          message:
            "No API key configured. Either send `X-PassQR-API-Key: pqr_live_…` " +
            "or set the `PASSQR_API_KEY` Worker secret for single-tenant use.",
        },
        401
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400
      );
    }

    const server = new McpServer(
      { name: "passqr", version: "0.1.1" },
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

    const messages = Array.isArray(body) ? body : [body];
    const results = await Promise.all(
      messages.map((msg) =>
        handleJsonRpc(
          server,
          msg as {
            jsonrpc: string;
            id?: number | string;
            method: string;
            params?: unknown;
          }
        )
      )
    );

    return jsonResponse(Array.isArray(body) ? results : results[0]);
  },
};
