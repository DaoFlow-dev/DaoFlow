import { getCurrentContext, type DaoFlowContext } from "./config";
import { buildAuthHeaders } from "./auth-headers";
import { getCurrentCommandRequestOptions } from "./command-helpers";

export class ApiClient {
  private ctx: DaoFlowContext;
  private timeoutMs: number;

  constructor(ctx?: DaoFlowContext, timeoutMs = getCurrentCommandRequestOptions().timeoutMs) {
    const resolved = ctx ?? getCurrentContext();
    if (!resolved) {
      throw new Error("Not logged in. Run `daoflow login` first.");
    }
    this.ctx = resolved;
    this.timeoutMs = timeoutMs;
  }

  get baseUrl(): string {
    return this.ctx.apiUrl.replace(/\/$/, "");
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...buildAuthHeaders(this.ctx.token, extra)
    };
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs);
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      signal: this.signal()
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ApiError(res.status, body);
    }
    return this.unwrapTrpc<T>(await res.json());
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string }
  ): Promise<T> {
    const extra: Record<string, string> = {};
    if (opts?.idempotencyKey) {
      extra["X-Idempotency-Key"] = opts.idempotencyKey;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(extra),
      body: body ? JSON.stringify(body) : undefined,
      signal: this.signal()
    });
    if (!res.ok) {
      const responseBody = await res.text();
      throw new ApiError(res.status, responseBody);
    }
    return this.unwrapTrpc<T>(await res.json());
  }

  /**
   * tRPC wraps all responses in { result: { data: ... } }.
   * This unwraps so callers get the actual payload.
   */
  private unwrapTrpc<T>(json: unknown): T {
    if (
      json &&
      typeof json === "object" &&
      "result" in json &&
      (json as Record<string, unknown>).result &&
      typeof (json as Record<string, unknown>).result === "object"
    ) {
      const result = (json as { result: Record<string, unknown> }).result;
      if ("data" in result) {
        return result.data as T;
      }
    }
    return json as T;
  }

  async streamUpload(
    path: string,
    stream: ReadableStream | NodeJS.ReadableStream,
    contentLength?: number,
    opts?: {
      headers?: Record<string, string>;
      contentType?: string;
    }
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": opts?.contentType ?? "application/octet-stream",
      ...buildAuthHeaders(this.ctx.token, opts?.headers)
    };
    if (contentLength) {
      headers["Content-Length"] = String(contentLength);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: stream as unknown as BodyInit,
      duplex: "half",
      signal: this.signal()
    } as RequestInit & { duplex: string });
    if (!res.ok) {
      const body = await res.text();
      throw new ApiError(res.status, body);
    }
    return res.json();
  }

  async sse(path: string, onEvent: (data: string) => void, abort?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "text/event-stream",
        ...buildAuthHeaders(this.ctx.token)
      },
      signal: abort
    });
    if (!res.ok || !res.body) {
      const body = await res.text();
      throw new ApiError(res.status, body);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          onEvent(line.slice(6));
        }
      }
    }
  }
}

/** Structured API error with status code for exit code mapping. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(`API ${statusCode}: ${body}`);
    this.name = "ApiError";
  }

  /** Map HTTP status to CLI exit code (2 = permission denied). */
  get exitCode(): number {
    if (this.statusCode === 403 || this.statusCode === 401) return 2;
    return 1;
  }
}
