import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PassQRClient } from "../passqr-client.js";
import { safe } from "./index.js";

/**
 * Admin tools — only useful when the caller's API key is a *partner key*
 * (pkr_*) with the `accounts:manage` scope. The MCP doesn't try to detect
 * this; it forwards whatever credential the user sent and lets the API
 * return 403 if the scope is missing. The error surfaces cleanly through
 * the standard `safe()` wrapper.
 */
export function registerAdminTools(server: McpServer, client: PassQRClient) {
  server.tool(
    "create_business",
    "Provision a new PassQR business (tenant). Returns a one-time API key and " +
      "a scoped MCP URL for the new business. ADMIN ONLY — requires a partner " +
      "key with the accounts:manage scope. DESTRUCTIVE: writes a billable row. " +
      "Confirm with the user before calling. Pass `idempotency_key` if you " +
      "might retry — repeated calls within 24h return the same business.",
    {
      name: z
        .string()
        .min(2)
        .max(120)
        .describe("Legal/display name, e.g. 'Me You Marketing Pte Ltd'."),
      owner_email: z
        .string()
        .email()
        .describe(
          "Email of the human owner. Becomes the auth.users record. Use a " +
            "shared mailbox (e.g. ops@company.com), not a personal address."
        ),
      plan: z
        .enum(["free", "starter", "pro"])
        .optional()
        .describe("Defaults to 'starter'. Wallet passes require starter+."),
      country: z
        .string()
        .length(2)
        .optional()
        .describe("ISO 3166-1 alpha-2, e.g. 'SG'. Defaults to 'SG'."),
      industry: z.string().optional(),
      website: z.string().url().optional(),
      brand_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional()
        .describe("Hex color, e.g. '#C5D451'."),
      logo_url: z
        .string()
        .url()
        .optional()
        .describe("Public HTTPS URL to a square PNG logo (>=480x480)."),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Arbitrary JSON for partner-specific tagging."),
      idempotency_key: z
        .string()
        .min(8)
        .max(80)
        .optional()
        .describe(
          "Optional — replays within 24h return the same business instead " +
            "of creating a duplicate. Recommended for retry-prone flows."
        ),
    },
    async (args) => safe(async () => client.createBusiness(args))
  );
}
