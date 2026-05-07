import type { ApiTokenScope, AppRole } from "@daoflow/shared";
import type { RequestAuthContext } from "./context";

export interface RequestAccessLogAttribution {
  authMethod: "session" | "api-token" | null;
  actorType: "user" | "service" | "agent" | "token" | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: AppRole | null;
  tokenId: string | null;
  tokenName: string | null;
  tokenPrefix: string | null;
  requiredScopes: readonly ApiTokenScope[];
  grantedScopes: readonly ApiTokenScope[];
  errorCategory: string | null;
}

const requestAttribution = new WeakMap<Headers, RequestAccessLogAttribution>();

export function buildAccessLogAttribution(input: {
  auth?: RequestAuthContext | null;
  requiredScopes?: readonly ApiTokenScope[];
  errorCategory?: string | null;
  grantedScopes?: readonly ApiTokenScope[];
  token?: { id: string; name: string; prefix: string } | null;
}): RequestAccessLogAttribution {
  const auth = input.auth ?? null;
  const token = auth?.token ?? input.token ?? null;
  return {
    authMethod: auth?.method ?? null,
    actorType: auth ? (auth.method === "api-token" ? auth.principal.type : "user") : null,
    actorId: auth?.principal.id ?? null,
    actorEmail: auth?.principal.email ?? null,
    actorRole: auth?.role ?? null,
    tokenId: token?.id ?? null,
    tokenName: token?.name ?? null,
    tokenPrefix: token?.prefix ?? null,
    requiredScopes: input.requiredScopes ?? [],
    grantedScopes: input.grantedScopes ?? auth?.capabilities ?? [],
    errorCategory: input.errorCategory ?? null
  };
}

export function rememberRequestAccessLogAttribution(
  headers: Headers,
  attribution: RequestAccessLogAttribution
): void {
  requestAttribution.set(headers, attribution);
}

export function readRequestAccessLogAttribution(
  headers: Headers
): RequestAccessLogAttribution | null {
  return requestAttribution.get(headers) ?? null;
}
