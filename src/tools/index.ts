import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PassQRClient } from "../passqr-client.js";
import { registerValidateTool } from "./validate.js";
import { registerTemplateTools } from "./templates.js";
import { registerPassTools } from "./passes.js";
import { registerWalletTools } from "./wallet.js";

export interface ToolContext {
  apiKey: string;
  apiBase: string;
}

export function registerAllTools(server: McpServer, ctx: ToolContext) {
  const client = new PassQRClient({
    apiBase: ctx.apiBase,
    apiKey: ctx.apiKey,
  });

  registerValidateTool(server, client);
  registerTemplateTools(server, client);
  registerPassTools(server, client);
  registerWalletTools(server, ctx.apiBase);
}

/**
 * Convert any thrown error into a consistent MCP tool result.
 * Tools should wrap their body with `safe(async () => ...)`.
 */
export async function safe<T>(fn: () => Promise<T>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const result = await fn();
    return {
      content: [
        {
          type: "text",
          text:
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const e = err as { status?: number; error?: string; message?: string };
    const msg =
      e?.message || e?.error
        ? `PassQR error (${e.status ?? "?"}): ${e.error ?? ""}${
            e.message ? ` — ${e.message}` : ""
          }`
        : `Unexpected error: ${String(err)}`;
    return {
      content: [{ type: "text", text: msg }],
      isError: true,
    };
  }
}
