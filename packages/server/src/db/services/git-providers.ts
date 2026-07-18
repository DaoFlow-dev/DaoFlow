/**
 * git-providers.ts — Service layer for Git provider management.
 *
 * Handles registration, listing, and token exchange for GitHub/GitLab Apps.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders, gitInstallations } from "../schema/git-providers";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import { decrypt, encrypt } from "../crypto";

/* ──────────────────────── Interfaces ──────────────────────── */

export interface RegisterGitProviderInput {
  teamId: string;
  type: "github" | "gitlab";
  name: string;
  appId?: string;
  clientId?: string;
  clientSecret?: string;
  privateKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateInstallationInput {
  teamId: string;
  providerId: string;
  installationId: string;
  accountName: string;
  accountType?: string;
  repositorySelection?: string;
  permissions?: string;
  installedByUserId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface GitProviderSummary {
  id: string;
  type: string;
  name: string;
  status: string;
  appId: string | null;
  clientId: string | null;
  baseUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitInstallationSummary {
  id: string;
  providerId: string;
  installationId: string;
  accountName: string;
  accountType: string;
  repositorySelection: string;
  status: string;
  installedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type StoredInstallationPermissions = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenType?: string;
  expiresAt?: string;
};

function toGitProviderSummary(row: typeof gitProviders.$inferSelect): GitProviderSummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    appId: row.appId,
    clientId: row.clientId,
    baseUrl: row.baseUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toGitInstallationSummary(
  row: typeof gitInstallations.$inferSelect
): GitInstallationSummary {
  return {
    id: row.id,
    providerId: row.providerId,
    installationId: row.installationId,
    accountName: row.accountName,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    status: row.status,
    installedByUserId: row.installedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function encodeGitInstallationPermissions(input: {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
}) {
  return JSON.stringify({
    accessTokenEncrypted: encrypt(input.accessToken),
    ...(input.refreshToken ? { refreshTokenEncrypted: encrypt(input.refreshToken) } : {}),
    tokenType: input.tokenType ?? "bearer",
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
  } satisfies StoredInstallationPermissions);
}

export function readGitInstallationOAuthCredentials(
  installation: Pick<typeof gitInstallations.$inferSelect, "permissions">
): {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: string | null;
} | null {
  if (!installation.permissions) return null;

  try {
    const parsed = JSON.parse(installation.permissions) as StoredInstallationPermissions;
    if (typeof parsed.accessTokenEncrypted !== "string") return null;
    return {
      accessToken: decrypt(parsed.accessTokenEncrypted),
      refreshToken:
        typeof parsed.refreshTokenEncrypted === "string"
          ? decrypt(parsed.refreshTokenEncrypted)
          : null,
      tokenType: parsed.tokenType ?? "bearer",
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null
    };
  } catch {
    return null;
  }
}

export function readGitInstallationAccessToken(
  installation: Pick<typeof gitInstallations.$inferSelect, "permissions">
): string | null {
  return readGitInstallationOAuthCredentials(installation)?.accessToken ?? null;
}

/* ──────────────────────── Git Providers ──────────────────────── */

export async function registerGitProvider(input: RegisterGitProviderInput) {
  const providerId = id();

  const [provider] = await db
    .insert(gitProviders)
    .values({
      id: providerId,
      teamId: input.teamId,
      type: input.type,
      name: input.name,
      appId: input.appId ?? null,
      clientId: input.clientId ?? null,
      clientSecretEncrypted: input.clientSecret ? encrypt(input.clientSecret) : null,
      privateKeyEncrypted: input.privateKey ? encrypt(input.privateKey) : null,
      webhookSecret: input.webhookSecret ?? null,
      baseUrl: input.baseUrl ?? null,
      status: "active",
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `git_provider/${providerId}`,
    action: "git_provider.register",
    inputSummary: `Registered ${input.type} provider "${input.name}"`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "git_provider",
      resourceId: providerId,
      teamId: input.teamId,
      providerType: input.type
    }
  });

  return { status: "ok" as const, provider, summary: toGitProviderSummary(provider) };
}

export async function listGitProviders(teamId: string) {
  return db
    .select()
    .from(gitProviders)
    .where(eq(gitProviders.teamId, teamId))
    .orderBy(desc(gitProviders.createdAt));
}

export async function listGitProviderSummaries(teamId: string) {
  const rows = await listGitProviders(teamId);
  return rows.map(toGitProviderSummary);
}

export async function getGitProvider(providerId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(gitProviders)
    .where(and(eq(gitProviders.id, providerId), eq(gitProviders.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

export async function getGitInstallation(installationId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(gitInstallations)
    .where(and(eq(gitInstallations.id, installationId), eq(gitInstallations.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

export async function deleteGitProvider(
  providerId: string,
  teamId: string,
  actor: { requestedByUserId: string; requestedByEmail: string; requestedByRole: AppRole }
) {
  const deleted = await db
    .delete(gitProviders)
    .where(and(eq(gitProviders.id, providerId), eq(gitProviders.teamId, teamId)))
    .returning({ id: gitProviders.id });

  if (!deleted[0]) {
    return { status: "not_found" as const };
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.requestedByUserId,
    actorEmail: actor.requestedByEmail,
    actorRole: actor.requestedByRole,
    targetResource: `git_provider/${providerId}`,
    action: "git_provider.delete",
    inputSummary: `Deleted git provider ${providerId}`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "git_provider",
      resourceId: providerId,
      teamId
    }
  });

  return { status: "ok" as const };
}

/* ──────────────────────── Installations ──────────────────────── */

export async function createGitInstallation(input: CreateInstallationInput) {
  const provider = await getGitProvider(input.providerId, input.teamId);
  if (!provider) {
    return { status: "not_found" as const };
  }

  const now = new Date();
  const installId = id();
  const [installation] = await db
    .insert(gitInstallations)
    .values({
      id: installId,
      teamId: input.teamId,
      providerId: input.providerId,
      installationId: input.installationId,
      accountName: input.accountName,
      accountType: input.accountType ?? "organization",
      repositorySelection: input.repositorySelection ?? "all",
      permissions: input.permissions ?? null,
      installedByUserId: input.installedByUserId ?? null,
      status: "active",
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [gitInstallations.providerId, gitInstallations.installationId],
      set: {
        accountName: input.accountName,
        accountType:
          input.accountType !== undefined
            ? input.accountType
            : sql`${gitInstallations.accountType}`,
        repositorySelection:
          input.repositorySelection !== undefined
            ? input.repositorySelection
            : sql`${gitInstallations.repositorySelection}`,
        permissions:
          input.permissions !== undefined
            ? input.permissions
            : sql`${gitInstallations.permissions}`,
        installedByUserId:
          input.installedByUserId !== undefined
            ? input.installedByUserId
            : sql`${gitInstallations.installedByUserId}`,
        status: "active",
        updatedAt: now
      }
    })
    .returning();

  if (!installation) {
    throw new Error("Expected git installation write to return a row.");
  }

  const auditAction =
    installation.id === installId ? "git_installation.create" : "git_installation.update";
  const auditSummary =
    installation.id === installId
      ? `Installed ${input.accountName} (installation ${input.installationId})`
      : `Updated ${input.accountName} (installation ${input.installationId})`;

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `git_installation/${installation.id}`,
    action: auditAction,
    inputSummary: auditSummary,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "git_installation",
      resourceId: installation.id,
      teamId: input.teamId,
      providerId: input.providerId,
      externalInstallationId: input.installationId
    }
  });

  return {
    status: "ok" as const,
    installation,
    summary: toGitInstallationSummary(installation)
  };
}

export async function listGitInstallations(teamId: string, providerId?: string) {
  const query = db.select().from(gitInstallations);
  if (providerId) {
    return query
      .where(and(eq(gitInstallations.providerId, providerId), eq(gitInstallations.teamId, teamId)))
      .orderBy(desc(gitInstallations.createdAt));
  }
  return query.where(eq(gitInstallations.teamId, teamId)).orderBy(desc(gitInstallations.createdAt));
}

export async function listGitInstallationSummaries(teamId: string, providerId?: string) {
  const rows = await listGitInstallations(teamId, providerId);
  return rows.map(toGitInstallationSummary);
}
