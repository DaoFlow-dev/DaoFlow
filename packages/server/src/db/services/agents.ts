/**
 * agents.ts
 *
 * Service layer for agent principal management and token generation.
 * Agents are constrained principals with explicit scopes — read-only by default.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { principals, apiTokens } from "../schema/tokens";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "@daoflow/shared";
import { normalizeApiTokenScopes, roleCapabilities } from "@daoflow/shared";
import { newId as id } from "./json-helpers";

/* ──────────────────────── Helpers ──────────────────────── */

/** Generate a random API token string. */
function generateTokenValue(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "dfl_";
  for (let i = 0; i < 48; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/** Hash a token for storage (simple SHA-256). */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ──────────────────────── Interfaces ──────────────────────── */

export interface CreateAgentInput {
  name: string;
  description?: string;
  scopes: string[];
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface GenerateTokenInput {
  principalId: string;
  tokenName: string;
  expiresInDays?: number;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface RevokeTokenInput {
  tokenId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

/* ──────────────────────── CRUD ──────────────────────── */

export async function createAgentPrincipal(input: CreateAgentInput) {
  // Validate scopes — agents can only have scopes from the agent role
  const validScopes = normalizeApiTokenScopes(input.scopes);
  const agentAllowed = roleCapabilities.agent;
  const filteredScopes = validScopes.filter((s) => (agentAllowed as readonly string[]).includes(s));

  const principalId = id();
  const [principal] = await db
    .insert(principals)
    .values({
      id: principalId,
      type: "agent",
      name: input.name,
      description: input.description ?? null,
      defaultScopes: filteredScopes.join(","),
      status: "active",
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `principal/${principalId}`,
    action: "agent.create",
    inputSummary: `Created agent "${input.name}" with ${filteredScopes.length} scopes`,
    permissionScope: "tokens:manage",
    outcome: "success",
    metadata: {
      resourceType: "principal",
      resourceId: principalId,
      scopes: filteredScopes
    }
  });

  return { status: "ok" as const, principal };
}

export async function listAgentPrincipals() {
  return db
    .select()
    .from(principals)
    .where(eq(principals.type, "agent"))
    .orderBy(desc(principals.createdAt));
}

export async function generateAgentToken(input: GenerateTokenInput) {
  // Verify the principal exists and is an agent
  const [principal] = await db
    .select()
    .from(principals)
    .where(and(eq(principals.id, input.principalId), eq(principals.type, "agent")))
    .limit(1);

  if (!principal) return { status: "not_found" as const };

  const tokenValue = generateTokenValue();
  const tokenHash = await hashToken(tokenValue);
  const tokenPrefix = tokenValue.slice(0, 12);
  const tokenId = id();

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [token] = await db
    .insert(apiTokens)
    .values({
      id: tokenId,
      name: input.tokenName,
      tokenHash,
      tokenPrefix,
      principalType: "agent",
      principalId: input.principalId,
      scopes: principal.defaultScopes ?? "",
      status: "active",
      expiresAt,
      createdByUserId: input.requestedByUserId
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `api_token/${tokenId}`,
    action: "agent.token.create",
    inputSummary: `Generated token "${input.tokenName}" for agent "${principal.name}"`,
    permissionScope: "tokens:manage",
    outcome: "success",
    metadata: {
      resourceType: "api_token",
      resourceId: tokenId,
      principalId: input.principalId
    }
  });

  // Return the plain-text token value only once
  return { status: "ok" as const, token, tokenValue };
}

export async function revokeAgentToken(input: RevokeTokenInput) {
  const [existing] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.id, input.tokenId))
    .limit(1);

  if (!existing) return { status: "not_found" as const };

  await db
    .update(apiTokens)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(apiTokens.id, input.tokenId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `api_token/${input.tokenId}`,
    action: "agent.token.revoke",
    inputSummary: `Revoked token "${existing.name}"`,
    permissionScope: "tokens:manage",
    outcome: "success",
    metadata: { resourceType: "api_token", resourceId: input.tokenId }
  });

  return { status: "ok" as const };
}

/** Generate a setup prompt that can be pasted into an AI agent. */
export function generateSetupPrompt(
  agentName: string,
  tokenValue: string,
  scopes: string[],
  apiBaseUrl: string
): string {
  const scopeList = scopes.length > 0 ? scopes.join(", ") : "read-only defaults";

  return `# DaoFlow Agent Setup — ${agentName}

You have been configured as an agent on a DaoFlow instance.

## Connection Details
- **API Base URL:** ${apiBaseUrl}
- **Agent Token:** ${tokenValue}
- **Granted Scopes:** ${scopeList}

## Authentication
Include the token in your API requests:
\`\`\`
Authorization: Bearer ${tokenValue}
\`\`\`

## Available CLI Commands
\`\`\`bash
# Check your identity and permissions
daoflow whoami --json --token ${tokenValue}

# List available capabilities
daoflow capabilities --json --token ${tokenValue}

# View deployment status
daoflow deployments --json --token ${tokenValue}

# View server status
daoflow status --json --token ${tokenValue}

# View logs
daoflow logs --json --token ${tokenValue}
\`\`\`

## Safety Constraints
- You default to **read-only** access
- Destructive operations require explicit elevated scopes
- All actions are audited with your agent identity
- Use \`--dry-run\` before executing mutations
- Request approval via \`approvals:create\` for gated operations
`;
}
