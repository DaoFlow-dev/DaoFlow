import { desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { apiTokens, principals } from "../schema/tokens";
import {
  getApiTokenScopeLanes,
  getEffectiveTokenCapabilities,
  normalizeApiTokenScopes,
  type ApiTokenScope,
  type ApiTokenScopeLane
} from "@daoflow/shared";

export async function listApiTokenInventory() {
  const tokens = await db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt));

  const mapped = tokens.map((t) => {
    const scopes = (t.scopes?.split(",").filter(Boolean) ?? []) as ApiTokenScope[];
    const lanes = getApiTokenScopeLanes(scopes);
    const effective = getEffectiveTokenCapabilities("viewer", scopes);
    const isReadOnly = lanes.length === 1 && lanes[0] === "read";

    return {
      id: t.id,
      name: t.name,
      label: t.name,
      principalType: t.principalType,
      principalKind: t.principalType,
      principalRole: t.principalType,
      principalId: t.principalId,
      principalName: t.principalId,
      tokenPrefix: t.tokenPrefix,
      status: t.status,
      scopes,
      lanes,
      effectiveCapabilities: effective,
      withheldCapabilities: [] as string[],
      isReadOnly,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null
    };
  });

  return {
    summary: {
      totalTokens: mapped.length,
      agentTokens: mapped.filter((t) => t.principalType === "agent").length,
      readOnlyTokens: mapped.filter((t) => t.isReadOnly).length,
      planningTokens: mapped.filter((t) => t.lanes.includes("planning")).length,
      commandTokens: mapped.filter((t) => t.lanes.includes("command")).length,
      inactiveTokens: mapped.filter((t) => t.status !== "active").length
    },
    tokens: mapped
  };
}

export async function listPrincipalInventory() {
  const rows = await db.select().from(principals).orderBy(desc(principals.createdAt));

  return {
    summary: {
      totalPrincipals: rows.length,
      humanPrincipals: rows.filter((p) => p.type === "user").length,
      serviceAccounts: rows.filter((p) => p.type === "service").length,
      agentPrincipals: rows.filter((p) => p.type === "agent").length,
      commandCapablePrincipals: 0
    },
    principals: rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      defaultScopes: p.defaultScopes,
      status: p.status,
      createdAt: p.createdAt.toISOString()
    }))
  };
}
