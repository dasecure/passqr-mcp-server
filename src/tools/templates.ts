import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PassQRClient } from "../passqr-client.js";
import { safe } from "./index.js";

export function registerTemplateTools(
  server: McpServer,
  client: PassQRClient
) {
  server.tool(
    "list_templates",
    "List the pass templates owned by the authenticated PassQR business. " +
      "Call this BEFORE create_pass so you know valid template_id values and the " +
      "template type (ticket, membership, loyalty, etc). Returns template id, name, " +
      "type, description, color, and any default settings.",
    {
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-indexed page number, default 1."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Results per page, default 20, max 100."),
    },
    async (args) => safe(async () => client.listTemplates(args))
  );
}
