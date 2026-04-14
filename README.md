# passqr-mcp-server

Model Context Protocol (MCP) server for [PassQR](https://www.passqr.com) — lets Claude and other LLM clients manage digital passes, memberships, and tickets on your behalf.

Deployed as a Cloudflare Worker at **`https://mcp.passqr.com/mcp`**.

## What it does

Exposes ten PassQR operations as MCP tools:

| Tool | Action |
|---|---|
| `validate_pass` | Validate a pass code, increment usage, record a scan |
| `list_templates` | List the business's pass templates |
| `list_passes` | List passes, filter by template or status |
| `get_pass` | Get full detail on a single pass by ID |
| `create_pass` | Create a new pass for a template |
| `update_pass` | Update a pass's holder info, data blob, or status |
| `revoke_pass` | Soft-delete / revoke a pass |
| `get_apple_wallet_url` | Build the Apple Wallet download URL for a pass |
| `get_google_wallet_url` | Build the Google Wallet save URL for a pass |
| `get_public_pass_url` | Build the public scan URL for a pass |

All operations are scoped to the PassQR business that owns the API key.

## Install in Claude.ai

1. Get a PassQR API key at <https://www.passqr.com/dashboard> (Starter or Pro plan required for API access).
2. In Claude.ai → Settings → Connectors → Add custom connector.
3. URL: `https://mcp.passqr.com/mcp`
4. Add header: `X-PassQR-API-Key` → `pqr_live_…`
5. Save. The ten tools will appear in Claude's tool picker.

## Local development

```bash
npm install

# Put your test API key in .dev.vars (gitignored):
echo 'PASSQR_API_KEY_DEFAULT=pqr_live_...' > .dev.vars

npm run dev          # runs on http://localhost:8787/mcp
```

Point an MCP client at `http://localhost:8787/mcp` with the header
`X-PassQR-API-Key: pqr_live_…` and you can exercise every tool.

## Deploy

```bash
wrangler login
wrangler deploy
```

Then in the Cloudflare dashboard, bind the Worker to `mcp.passqr.com/*` (or uncomment the `routes` block in `wrangler.toml` and redeploy).

## Auth model

**v1 (current):** each request carries an `X-PassQR-API-Key` header. The Worker forwards it as `Authorization: Bearer <key>` to `/api/v1/*`. Keys never touch storage or logs.

**v2 (planned):** proper OAuth 2.1 flow — Claude → PassQR consent page → token returned to MCP host → no raw keys in headers. Will use `@cloudflare/workers-oauth-provider` and add Durable Objects for session state. v1 clients keep working.

## Architecture notes

- Stateless — no DB, no KV, no Durable Objects in v1. Everything proxies to the PassQR Next.js API on Vercel.
- CORS on PassQR stays locked down; this Worker is the trust edge.
- Per-tool rate limits are enforced upstream by PassQR (`/api/v1/*` uses `checkRateLimit`).
- Scan events already land in `public.scans` — a webhook → iotPush bridge can be added separately without touching this repo.

## Roadmap

- [x] v1.0 — 10 tools above, Streamable HTTP transport, API-key header auth
- [ ] v1.1 — `/api/v1/passes/bulk` tool (requires PassQR server addition)
- [ ] v1.2 — `/api/v1/passes/:id/email` tool (same)
- [ ] v1.3 — Business card tools (`list_business_cards`, `get_vcard_url`, etc.)
- [ ] v2.0 — OAuth flow, remove API-key header

## License

MIT © DaSecure LLC
