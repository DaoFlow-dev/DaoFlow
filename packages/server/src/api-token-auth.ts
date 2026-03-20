import { eq } from "drizzle-orm";
import {
  getEffectiveTokenCapabilities,
  normalizeAppRole,
  normalizeApiTokenScopes,
  type ApiTokenScope,
  type AppRole
} from "@daoflow/shared";
import type { AuthSession } from "./auth";
import { db } from "./db/connection";
import { apiTokens, principals } from "./db/schema/tokens";
import { users } from "./db/schema/users";
import { hashApiToken, parseBearerApiToken } from "./api-token-utils";

export interface TokenBackedSessionPrincipal {
  id: string;
  email: string;
  name: string | null;
  type: "user" | "service" | "agent";
  linkedUserId: string | null;
}

export interface TokenBackedSession {
  session: NonNullable<AuthSession>;
  principal: TokenBackedSessionPrincipal;
  role: AppRole;
  presentedScopes: ApiTokenScope[];
  effectiveCapabilities: ApiTokenScope[];
  token: {
    id: string;
    name: string;
    prefix: string;
    expiresAt: string | null;
  };
}

export type TokenAuthFailureCode =
  | "TOKEN_INVALID"
  | "TOKEN_REVOKED"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALIDATED";

export interface TokenAuthFailure {
  code: TokenAuthFailureCode;
  error: string;
}

export type TokenAuthResolution =
  | { status: "absent" }
  | { status: "ok"; auth: TokenBackedSession }
  | { status: "rejected"; failure: TokenAuthFailure };

function getPrincipalRole(principalType: string, userRole: unknown): AppRole {
  if (principalType === "agent") {
    return "agent";
  }

  if (principalType === "service") {
    return "developer";
  }

  return normalizeAppRole(userRole);
}

function buildSyntheticPrincipalEmail(principalName: string, principalType: string): string {
  const slug =
    principalName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "principal";
  return `${slug}.${principalType}@token.daoflow.local`;
}

export async function resolveBearerTokenAuth(
  headerValue: string | null | undefined
): Promise<TokenBackedSession | null> {
  const rawToken = parseBearerApiToken(headerValue);
  if (!rawToken) {
    return null;
  }

  const result = await resolveBearerTokenAuthResult(headerValue);
  return result.status === "ok" ? result.auth : null;
}

function rejectToken(code: TokenAuthFailureCode, error: string): TokenAuthResolution {
  return {
    status: "rejected",
    failure: {
      code,
      error
    }
  };
}

export async function resolveBearerTokenAuthResult(
  headerValue: string | null | undefined
): Promise<TokenAuthResolution> {
  const rawToken = parseBearerApiToken(headerValue);
  if (!rawToken) {
    return { status: "absent" };
  }

  const tokenHash = await hashApiToken(rawToken);
  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      tokenName: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      tokenScopes: apiTokens.scopes,
      tokenStatus: apiTokens.status,
      tokenCreatedAt: apiTokens.createdAt,
      tokenExpiresAt: apiTokens.expiresAt,
      tokenRevokedAt: apiTokens.revokedAt,
      principalId: principals.id,
      principalType: principals.type,
      principalName: principals.name,
      principalStatus: principals.status,
      linkedUserId: principals.linkedUserId,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      userRole: users.role,
      userStatus: users.status,
      tokensInvalidBefore: users.tokensInvalidBefore
    })
    .from(apiTokens)
    .leftJoin(principals, eq(principals.id, apiTokens.principalId))
    .leftJoin(users, eq(users.id, principals.linkedUserId))
    .where(eq(apiTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    return rejectToken("TOKEN_INVALID", "API token is invalid.");
  }

  if (row.tokenStatus !== "active" || row.tokenRevokedAt) {
    return rejectToken("TOKEN_REVOKED", "API token has been revoked.");
  }

  if (
    !row.principalId ||
    !row.principalType ||
    !row.principalName ||
    row.principalStatus !== "active"
  ) {
    return rejectToken("TOKEN_INVALIDATED", "API token has been invalidated.");
  }

  const now = Date.now();
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now) {
    return rejectToken("TOKEN_EXPIRED", "API token has expired.");
  }

  if (row.tokensInvalidBefore && row.tokenCreatedAt.getTime() < row.tokensInvalidBefore.getTime()) {
    return rejectToken("TOKEN_INVALIDATED", "API token has been invalidated.");
  }

  if (row.userId && row.userStatus !== "active") {
    return rejectToken("TOKEN_INVALIDATED", "API token has been invalidated.");
  }

  const role = getPrincipalRole(row.principalType, row.userRole);
  const presentedScopes = normalizeApiTokenScopes(row.tokenScopes.split(",").filter(Boolean));
  const effectiveCapabilities = getEffectiveTokenCapabilities(role, presentedScopes);
  const principalId = row.userId ?? row.principalId;
  const principalEmail =
    row.userEmail ?? buildSyntheticPrincipalEmail(row.principalName, row.principalType);
  const principalName = row.userName ?? row.principalName;

  return {
    status: "ok",
    auth: {
      session: {
        user: {
          id: principalId,
          email: principalEmail,
          name: principalName,
          emailVerified: Boolean(row.userId),
          createdAt: row.tokenCreatedAt,
          updatedAt: row.tokenCreatedAt,
          image: null,
          role
        },
        session: {
          id: row.tokenId,
          userId: principalId,
          expiresAt: row.tokenExpiresAt ?? new Date("9999-12-31T23:59:59.999Z"),
          token: row.tokenPrefix,
          createdAt: row.tokenCreatedAt,
          updatedAt: row.tokenCreatedAt,
          ipAddress: null,
          userAgent: "api-token"
        }
      } as NonNullable<AuthSession>,
      principal: {
        id: row.principalId,
        email: principalEmail,
        name: principalName,
        type: row.principalType as "user" | "service" | "agent",
        linkedUserId: row.linkedUserId
      },
      role,
      presentedScopes,
      effectiveCapabilities,
      token: {
        id: row.tokenId,
        name: row.tokenName,
        prefix: row.tokenPrefix,
        expiresAt: row.tokenExpiresAt?.toISOString() ?? null
      }
    }
  };
}
