import { getCurrentContext, type DaoFlowContext } from "./config";

export class ApiClient {
  private ctx: DaoFlowContext;

  constructor(ctx?: DaoFlowContext) {
    const resolved = ctx ?? getCurrentContext();
    if (!resolved) {
      throw new Error("Not logged in. Run `daoflow login` first.");
    }
    this.ctx = resolved;
  }

  get baseUrl(): string {
    return this.ctx.apiUrl.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.ctx.token}`,
      "Content-Type": "application/json"
    };
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers()
    });
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async streamUpload(
    path: string,
    stream: ReadableStream | NodeJS.ReadableStream,
    contentLength?: number
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.ctx.token}`,
      "Content-Type": "application/octet-stream"
    };
    if (contentLength) {
      headers["Content-Length"] = String(contentLength);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: stream as unknown as BodyInit,
      duplex: "half"
    } as RequestInit & { duplex: string });
    if (!res.ok) {
      throw new Error(`Upload failed ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async sse(path: string, onEvent: (data: string) => void, abort?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.ctx.token}`,
        Accept: "text/event-stream"
      },
      signal: abort
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE ${res.status}: ${await res.text()}`);
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
