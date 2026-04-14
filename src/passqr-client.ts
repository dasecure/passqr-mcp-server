/**
 * Thin typed wrapper around the PassQR v1 API.
 * Every tool handler goes through this — keeps error handling and
 * the API-key plumbing in one place.
 */

export interface PassQRClientConfig {
  apiBase: string;
  apiKey: string;
}

export interface PassQRError {
  status: number;
  error: string;
  message?: string;
  raw?: unknown;
}

export class PassQRClient {
  constructor(private readonly config: PassQRClientConfig) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.config.apiBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
        "user-agent": "passqr-mcp-server/0.1.0",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON (HTML 404 page, plain text).
      }
    }

    if (!res.ok) {
      const payload = (parsed ?? {}) as { error?: string; message?: string };
      const err: PassQRError = {
        status: res.status,
        error: payload.error ?? `HTTP ${res.status}`,
        message: payload.message,
        raw: parsed ?? text,
      };
      throw err;
    }

    return parsed as T;
  }

  // --- Templates ---

  listTemplates(params: { page?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request<TemplateListResponse>(
      "GET",
      `/api/v1/templates${qs ? `?${qs}` : ""}`
    );
  }

  // --- Passes ---

  listPasses(
    params: {
      page?: number;
      limit?: number;
      template_id?: string;
      status?: string;
    } = {}
  ) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.template_id) q.set("template_id", params.template_id);
    if (params.status) q.set("status", params.status);
    const qs = q.toString();
    return this.request<PassListResponse>(
      "GET",
      `/api/v1/passes${qs ? `?${qs}` : ""}`
    );
  }

  getPass(id: string) {
    return this.request<{ data: Pass }>(
      "GET",
      `/api/v1/passes/${encodeURIComponent(id)}`
    );
  }

  createPass(input: CreatePassInput) {
    return this.request<{ data: Pass }>("POST", `/api/v1/passes`, input);
  }

  updatePass(id: string, patch: UpdatePassInput) {
    return this.request<{ data: Pass }>(
      "PATCH",
      `/api/v1/passes/${encodeURIComponent(id)}`,
      patch
    );
  }

  revokePass(id: string) {
    return this.request<{ data: Pass; message: string }>(
      "DELETE",
      `/api/v1/passes/${encodeURIComponent(id)}`
    );
  }

  // --- Validation ---

  validatePass(code: string) {
    return this.request<{ data: ValidateResult }>("POST", `/api/v1/validate`, {
      code,
    });
  }
}

// --- Types ---

export interface Template {
  id: string;
  name: string;
  type: string;
  description: string | null;
  color: string | null;
  logo_url: string | null;
  fields: unknown[];
  settings: Record<string, unknown>;
  created_at: string;
}

export interface Pass {
  id: string;
  code: string;
  holder_name: string | null;
  holder_email: string | null;
  data: Record<string, unknown>;
  status: "active" | "used" | "expired" | "revoked";
  uses_count: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at?: string;
  template_id: string;
}

export interface TemplateListResponse {
  data: Template[];
  meta: { page: number; limit: number; total: number };
}

export interface PassListResponse {
  data: Pass[];
  meta: { page: number; limit: number; total: number };
}

export interface CreatePassInput {
  template_id: string;
  holder_name?: string;
  holder_email?: string;
  data?: Record<string, unknown>;
  max_uses?: number;
  expires_at?: string;
}

export interface UpdatePassInput {
  holder_name?: string;
  holder_email?: string;
  data?: Record<string, unknown>;
  status?: "active" | "used" | "expired" | "revoked";
}

export interface ValidateResult {
  result: "valid" | "expired" | "used" | "revoked" | "not_found";
  message?: string;
  pass: {
    id: string;
    code: string;
    holder_name: string | null;
    holder_email: string | null;
    status: string;
    uses_count: number;
    max_uses: number | null;
    expires_at: string | null;
  } | null;
  template: {
    id: string;
    name: string;
    type: string;
    color: string | null;
  } | null;
}
