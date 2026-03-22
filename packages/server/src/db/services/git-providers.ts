/**
 * git-providers.ts — Service layer for Git provider management.
 *
 * Handles registration, listing, and token exchange for GitHub/GitLab Apps.
 */

import { desc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders, gitInstallations } from "../schema/git-providers";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import { decrypt, encrypt } from "../crypto";

/* ──────────────────────── Interfaces ──────────────────────── */

export interface RegisterGitProviderInput {
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

type StoredInstallationPermissions =
  | { accessTokenEncrypted: string; tokenType?: string }
  | { access_token: string; token_type?: string };

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
  tokenType?: string;
}) {
  return JSON.stringify({
    accessTokenEncrypted: encrypt(input.accessToken),
    tokenType: input.tokenType ?? "bearer"
  } satisfies StoredInstallationPermissions);
}

export function readGitInstallationAccessToken(
  installation: Pick<typeof gitInstallations.$inferSelect, "permissions">
): string | null {
  if (!installation.permissions) {
    return null;
  }

  try {
    const parsed = JSON.parse(installation.permissions) as StoredInstallationPermissions;

    if ("accessTokenEncrypted" in parsed && typeof parsed.accessTokenEncrypted === "string") {
      return decrypt(parsed.accessTokenEncrypted);
    }

    if ("access_token" in parsed && typeof parsed.access_token === "string") {
      return parsed.access_token;
    }
  } catch {
    return null;
  }

  return null;
}

/* ──────────────────────── Git Providers ──────────────────────── */

export async function registerGitProvider(input: RegisterGitProviderInput) {
  const providerId = id();

  const [provider] = await db
    .insert(gitProviders)
    .values({
      id: providerId,
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
      providerType: input.type
    }
  });

  return { status: "ok" as const, provider, summary: toGitProviderSummary(provider) };
}

export async function listGitProviders() {
  return db.select().from(gitProviders).orderBy(desc(gitProviders.createdAt));
}

export async function listGitProviderSummaries() {
  const rows = await listGitProviders();
  return rows.map(toGitProviderSummary);
}

export async function getGitProvider(providerId: string) {
  const [row] = await db
    .select()
    .from(gitProviders)
    .where(eq(gitProviders.id, providerId))
    .limit(1);
  return row ?? null;
}

export async function getGitInstallation(installationId: string) {
  const [row] = await db
    .select()
    .from(gitInstallations)
    .where(eq(gitInstallations.id, installationId))
    .limit(1);
  return row ?? null;
}

export async function deleteGitProvider(
  providerId: string,
  actor: { requestedByUserId: string; requestedByEmail: string; requestedByRole: AppRole }
) {
  await db.delete(gitProviders).where(eq(gitProviders.id, providerId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.requestedByUserId,
    actorEmail: actor.requestedByEmail,
    actorRole: actor.requestedByRole,
    targetResource: `git_provider/${providerId}`,
    action: "git_provider.delete",
    inputSummary: `Deleted git provider ${providerId}`,
    permissionScope: "server:write",
    outcome: "success"
  });

  return { status: "ok" as const };
}

/* ──────────────────────── Installations ──────────────────────── */

export async function createGitInstallation(input: CreateInstallationInput) {
  const now = new Date();
  const installId = id();
  const [installation] = await db
    .insert(gitInstallations)
    .values({
      id: installId,
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
      providerId: input.providerId
    }
  });

  return {
    status: "ok" as const,
    installation,
    summary: toGitInstallationSummary(installation)
  };
}

export async function listGitInstallations(providerId?: string) {
  const query = db.select().from(gitInstallations);
  if (providerId) {
    return query
      .where(eq(gitInstallations.providerId, providerId))
      .orderBy(desc(gitInstallations.createdAt));
  }
  return query.orderBy(desc(gitInstallations.createdAt));
}

export async function listGitInstallationSummaries(providerId?: string) {
  const rows = await listGitInstallations(providerId);
  return rows.map(toGitInstallationSummary);
}
