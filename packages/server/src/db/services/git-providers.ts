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
import {
  readGitLabCredential,
  readGitLabCredentialScopes,
  type GitLabCredentialStorage
} from "./gitlab-credentials";
import { readLegacyGitInstallationOAuthCredentials } from "./git-installation-legacy-credentials";
import { toGitInstallationSummary, toGitProviderSummary } from "./git-provider-summaries";

export { encodeGitInstallationPermissions } from "./git-installation-legacy-credentials";
export {
  registerGitProvider,
  updateGitProviderCa,
  type RegisterGitLabCredential,
  type RegisterGitProviderInput,
  type UpdateGitProviderCaInput
} from "./git-provider-registration";
export type { GitInstallationSummary, GitProviderSummary } from "./git-provider-summaries";

/* ──────────────────────── Interfaces ──────────────────────── */

export interface CreateInstallationInput {
  teamId: string;
  providerId: string;
  installationId: string;
  accountName: string;
  accountType?: string;
  repositorySelection?: string;
  permissions?: string;
  credentialStorage?: GitLabCredentialStorage;
  auditMetadata?: Record<string, unknown>;
  installedByUserId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export function readGitInstallationOAuthCredentials(
  installation: Pick<
    typeof gitInstallations.$inferSelect,
    | "permissions"
    | "credentialKind"
    | "credentialScopes"
    | "credentialExpiresAt"
    | "credentialEncrypted"
    | "credentialEnvelopeVersion"
  >
): {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: string | null;
} | null {
  const credential = readGitLabCredential(installation);
  if (credential?.kind === "oauth") {
    return {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      tokenType: credential.tokenType,
      expiresAt: credential.expiresAt
    };
  }

  return readLegacyGitInstallationOAuthCredentials(installation);
}

export function readGitInstallationAccessToken(
  installation: Parameters<typeof readGitInstallationOAuthCredentials>[0]
): string | null {
  const credential = readGitLabCredential(installation);
  if (credential?.kind === "api_token") return credential.token;
  if (credential?.kind === "oauth") return credential.accessToken;
  return readLegacyGitInstallationOAuthCredentials(installation)?.accessToken ?? null;
}

/* ──────────────────────── Git Providers ──────────────────────── */

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
      ...(input.credentialStorage ?? {}),
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
        credentialKind: input.credentialStorage
          ? input.credentialStorage.credentialKind
          : sql`${gitInstallations.credentialKind}`,
        credentialScopes: input.credentialStorage
          ? input.credentialStorage.credentialScopes
          : sql`${gitInstallations.credentialScopes}`,
        credentialExpiresAt: input.credentialStorage
          ? input.credentialStorage.credentialExpiresAt
          : sql`${gitInstallations.credentialExpiresAt}`,
        credentialEncrypted: input.credentialStorage
          ? input.credentialStorage.credentialEncrypted
          : sql`${gitInstallations.credentialEncrypted}`,
        credentialEnvelopeVersion: input.credentialStorage
          ? input.credentialStorage.credentialEnvelopeVersion
          : sql`${gitInstallations.credentialEnvelopeVersion}`,
        credentialKeyId: input.credentialStorage
          ? input.credentialStorage.credentialKeyId
          : sql`${gitInstallations.credentialKeyId}`,
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
      externalInstallationId: input.installationId,
      ...(input.credentialStorage
        ? {
            credentialKind: input.credentialStorage.credentialKind,
            credentialScopes: readGitLabCredentialScopes(input.credentialStorage.credentialScopes),
            credentialExpiresAt: input.credentialStorage.credentialExpiresAt?.toISOString() ?? null
          }
        : {}),
      ...(input.auditMetadata ?? {})
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
