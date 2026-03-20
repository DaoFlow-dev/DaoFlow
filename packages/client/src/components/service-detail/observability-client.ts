import { maybeRedirectToLoginForHttpStatus } from "@/lib/auth-redirect";

interface ObservabilityErrorBody {
  error?: string;
  code?: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryPercent: number;
  networkRxMB: number;
  networkTxMB: number;
  blockReadMB: number;
  blockWriteMB: number;
  pids: number;
  uptime: string;
  restartCount: number;
}

export interface ServiceLogLine {
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
}

export interface ObservabilityRequestError {
  status: number;
  code: string | null;
  message: string;
}

export function buildObservabilityWebSocketUrl(
  path: string,
  params: Record<string, string | number | undefined>
) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function readObservabilityJson<T>(
  path: string
): Promise<{ ok: true; data: T } | { ok: false; error: ObservabilityRequestError }> {
  try {
    const response = await fetch(path, {
      credentials: "same-origin"
    });

    if (response.ok) {
      return {
        ok: true,
        data: (await response.json()) as T
      };
    }

    maybeRedirectToLoginForHttpStatus(response.status);

    let body: ObservabilityErrorBody | null = null;
    try {
      body = (await response.json()) as ObservabilityErrorBody;
    } catch {
      body = null;
    }

    return {
      ok: false,
      error: {
        status: response.status,
        code: body?.code ?? null,
        message:
          body?.error ??
          response.statusText ??
          "The DaoFlow control plane could not fulfill the observability request."
      }
    };
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: "NETWORK_ERROR",
        message: "The DaoFlow control plane is unreachable right now."
      }
    };
  }
}
