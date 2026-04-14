import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safe } from "./index.js";

/**
 * Wallet tools don't hit the API — they just construct the public URLs.
 * The underlying routes (/api/wallet/apple, /api/wallet/google) handle their
 * own auth against the pass code. Giving the LLM a URL it can return to the
 * user is cleaner than streaming a .pkpass binary through the MCP transport.
 */
export function registerWalletTools(server: McpServer, apiBase: string) {
  const base = apiBase.replace(/\/$/, "");

  server.tool(
    "get_apple_wallet_url",
    "Build the Apple Wallet download URL for a pass code. The user opens this on an " +
      "iPhone to add the pass to Apple Wallet. Requires the business to be on Starter " +
      "or Pro plan. Returns a URL string — do NOT try to fetch or stream the file.",
    { code: z.string().describe("Pass code, e.g. 'PASS-ABC12345'.") },
    async ({ code }) =>
      safe(async () => ({
        url: `${base}/api/wallet/apple?code=${encodeURIComponent(code)}`,
        note: "Open this URL on an iOS device to add the pass to Apple Wallet.",
      }))
  );

  server.tool(
    "get_google_wallet_url",
    "Build the Google Wallet save URL for a pass code. The user opens this on an " +
      "Android device (or any browser signed into a Google account) to save the pass. " +
      "Requires Starter or Pro plan.",
    { code: z.string() },
    async ({ code }) =>
      safe(async () => ({
        url: `${base}/api/wallet/google?code=${encodeURIComponent(code)}`,
        note: "Open this URL to save the pass to Google Wallet.",
      }))
  );

  server.tool(
    "get_public_pass_url",
    "Build the public landing page URL for a pass — useful to share with the holder " +
      "via email, SMS, or chat. Anyone with the URL can view the pass's QR code but " +
      "cannot modify it.",
    { code: z.string() },
    async ({ code }) =>
      safe(async () => ({
        url: `${base}/p/${encodeURIComponent(code)}`,
        note: "Public pass page. Share with the holder so they can view the QR.",
      }))
  );
}
