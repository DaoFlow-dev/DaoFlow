import { buildAuthHeaders } from "./auth-headers";
import { getCurrentContext } from "./config";

type WebSocketFactory = (url: string, options: { headers: Record<string, string> }) => WebSocket;

let webSocketFactory: WebSocketFactory = (url, options) => {
  const AuthenticatedWebSocket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> }
  ) => WebSocket;
  return new AuthenticatedWebSocket(url, options);
};

export function setWebSocketFactoryForTests(factory: WebSocketFactory) {
  webSocketFactory = factory;
}

export function resetWebSocketFactoryForTests() {
  webSocketFactory = (url, options) => {
    const AuthenticatedWebSocket = WebSocket as unknown as new (
      url: string,
      options: { headers: Record<string, string> }
    ) => WebSocket;
    return new AuthenticatedWebSocket(url, options);
  };
}

export function buildWebSocketUrl(path: string, params?: Record<string, string | number>) {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error("Not logged in. Run `daoflow login` first.");
  }

  const url = new URL(path, ctx.apiUrl.replace(/\/$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return { url: url.toString(), headers: buildAuthHeaders(ctx.token) };
}

export function createAuthenticatedWebSocket(
  path: string,
  params?: Record<string, string | number>
) {
  const { url, headers } = buildWebSocketUrl(path, params);
  return webSocketFactory(url, { headers });
}
