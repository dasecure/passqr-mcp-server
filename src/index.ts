/**
 * PassQR MCP Server — Cloudflare Worker entry point.
 *
 * Exposes an MCP JSON-RPC endpoint at /mcp over plain HTTP POST.
 * Auth: PassQR API key on `X-PassQR-API-Key` header → forwarded as
 * `Authorization: Bearer <key>` to the PassQR v1 API.
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
  PASSQR_API_KEY_DEFAULT?: string;
}

function extractApiKey(request: Request, env: Env): string | null {
  const headerKey = request.headers.get("x-passqr-api-key");
  if (headerKey) return headerKey.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  if (env.PASSQR_API_KEY_DEFAULT) return env.PASSQR_API_KEY_DEFAULT;
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Minimal in-process JSON-RPC driver.
 *
 * McpServer registers request handlers on an underlying Server instance.
 * We grab that Server's registered handlers via `.server._requestHandlers`
 * (public-ish — it's how the transports themselves dispatch) and invoke
 * the matching one for the incoming method.
 */
async function handleJsonRpc(
  mcp: McpServer,
  message: { jsonrpc: string; id?: number | string; method: string; params?: unknown }
): Promise<unknown> {
  const underlying = (mcp as unknown as { server: Server }).server;

  // SDK stores handlers on `_requestHandlers` (Map<method, handler>).
  const handlers = (underlying as unknown as {
    _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
  })._requestHandlers;

  const handler = handlers.get(message.method);
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32601, message: `Method not found: ${message.method}` },
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

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "passqr-mcp-server",
        version: "0.1.0",
        endpoint: "/mcp",
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found — MCP endpoint lives at /mcp", {
        status: 404,
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
            "Send your PassQR API key as `X-PassQR-API-Key` or `Authorization: Bearer pqr_live_...`.",
        },
        401
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        400
      );
    }

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

    // Handle either a single JSON-RPC message or a batch.
    const messages = Array.isArray(body) ? body : [body];
    const results = await Promise.all(
      messages.map((msg) =>
        handleJsonRpc(
          server,
          msg as { jsonrpc: string; id?: number | string; method: string; params?: unknown }
        )
      )
    );

    return jsonResponse(Array.isArray(body) ? results : results[0]);
  },
};
