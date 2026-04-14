import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PassQRClient } from "../passqr-client.js";
import { safe } from "./index.js";

export function registerPassTools(server: McpServer, client: PassQRClient) {
  server.tool(
    "list_passes",
    "List passes for the authenticated business. Supports filtering by template_id " +
      "and status. Use this to answer 'how many passes have I issued', 'show me active " +
      "VIP memberships', etc.",
    {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      template_id: z
        .string()
        .uuid()
        .optional()
        .describe("Filter to a single template."),
      status: z
        .enum(["active", "used", "expired", "revoked"])
        .optional(),
    },
    async (args) => safe(async () => client.listPasses(args))
  );

  server.tool(
    "get_pass",
    "Get full detail on a single pass by its UUID. Use this after list_passes when " +
      "the user wants to inspect a specific pass.",
    { id: z.string().uuid() },
    async ({ id }) => safe(async () => client.getPass(id))
  );

  server.tool(
    "create_pass",
    "Create a new pass under an existing template. DESTRUCTIVE: writes a row to the " +
      "business's passes table and counts toward their plan quota — confirm with the " +
      "user before creating more than one at a time. Requires template_id from " +
      "list_templates. Holder name/email are optional but strongly recommended for " +
      "tickets and memberships.",
    {
      template_id: z
        .string()
        .uuid()
        .describe("Template UUID from list_templates."),
      holder_name: z.string().optional(),
      holder_email: z.string().email().optional(),
      data: z
        .record(z.unknown())
        .optional()
        .describe("Arbitrary per-pass metadata (JSON object)."),
      max_uses: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Override the template's default max_uses."),
      expires_at: z
        .string()
        .datetime()
        .optional()
        .describe("ISO 8601 timestamp."),
    },
    async (args) => safe(async () => client.createPass(args))
  );

  server.tool(
    "update_pass",
    "Update a pass's holder info, data blob, or status. Destructive — confirm with " +
      "the user before changing status to 'revoked' or 'used'.",
    {
      id: z.string().uuid(),
      holder_name: z.string().optional(),
      holder_email: z.string().email().optional(),
      data: z.record(z.unknown()).optional(),
      status: z
        .enum(["active", "used", "expired", "revoked"])
        .optional(),
    },
    async ({ id, ...patch }) =>
      safe(async () => client.updatePass(id, patch))
  );

  server.tool(
    "revoke_pass",
    "Revoke (soft-delete) a pass by setting its status to 'revoked'. The pass is not " +
      "deleted from the database; it just stops validating. DESTRUCTIVE — always " +
      "confirm with the user first.",
    { id: z.string().uuid() },
    async ({ id }) => safe(async () => client.revokePass(id))
  );
}
