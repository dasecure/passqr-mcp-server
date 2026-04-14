import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PassQRClient } from "../passqr-client.js";
import { safe } from "./index.js";

export function registerValidateTool(
  server: McpServer,
  client: PassQRClient
) {
  server.tool(
    "validate_pass",
    "Validate a PassQR pass by its code (e.g. 'PASS-ABC12345'). On a valid pass, " +
      "this increments the usage count, records a scan event, and may mark the pass " +
      "as 'used' if max_uses was reached. Returns one of: valid | expired | used | " +
      "revoked | not_found. Use this when the user asks to check, scan, or redeem a pass.",
    {
      code: z
        .string()
        .min(1)
        .describe("Pass code, e.g. 'PASS-ABC12345'. Case-insensitive."),
    },
    async ({ code }) =>
      safe(async () => {
        const res = await client.validatePass(code);
        return res.data;
      })
  );
}
