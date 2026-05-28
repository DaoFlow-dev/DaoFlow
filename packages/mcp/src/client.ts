/**
 * Typed tRPC client factory for the MCP server.
 *
 * Auth and transport mirror the CLI: a single httpLink to `<apiUrl>/trpc`,
 * Bearer/cookie auth, and a request timeout.
 */
import { createTRPCClient, httpLink } from "@trpc/client";
import { buildAuthHeaders } from "./auth-headers";
import { resolveConnection } from "./config";
import type { DaoFlowMcpClient, DaoFlowRouterBase } from "./trpc-contract";

const REQUEST_TIMEOUT_MS = 30_000;

function createClient(apiUrl: string, token: string): DaoFlowMcpClient {
  const baseUrl = apiUrl.replace(/\/$/, "");

  return createTRPCClient<DaoFlowRouterBase>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
        headers() {
          return buildAuthHeaders(token);
        },
        fetch(url, options) {
          // tRPC's httpLink supplies its own AbortSignal, so compose it with the
          // timeout rather than falling back only when no signal is present.
          const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
          const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
          return fetch(url, { ...options, signal });
        }
      })
    ]
  }) as unknown as DaoFlowMcpClient;
}

/**
 * Build a memoized client getter. The connection is resolved lazily on first
 * use so the MCP server can advertise its tools even before credentials are
 * configured — calls then fail with a clear, agent-readable error.
 */
export function createClientGetter(): () => DaoFlowMcpClient {
  let cached: DaoFlowMcpClient | null = null;

  return () => {
    if (!cached) {
      const { apiUrl, token } = resolveConnection();
      cached = createClient(apiUrl, token);
    }

    return cached;
  };
}
