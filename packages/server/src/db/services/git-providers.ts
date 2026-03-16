/**
 * git-providers.ts — Service layer for Git provider management.
 *
 * Handles registration, listing, and token exchange for GitHub/GitLab Apps.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders, gitInstallations } from "../schema/git-providers";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";

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
      clientSecretEncrypted: input.clientSecret ?? null, // TODO: encrypt
      privateKeyEncrypted: input.privateKey ?? null, // TODO: encrypt
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

  return { status: "ok" as const, provider };
}

export async function listGitProviders() {
  return db.select().from(gitProviders).orderBy(desc(gitProviders.createdAt));
}

export async function getGitProvider(providerId: string) {
  const [row] = await db
    .select()
    .from(gitProviders)
    .where(eq(gitProviders.id, providerId))
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
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `git_installation/${installId}`,
    action: "git_installation.create",
    inputSummary: `Installed ${input.accountName} (installation ${input.installationId})`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "git_installation",
      resourceId: installId,
      providerId: input.providerId
    }
  });

  return { status: "ok" as const, installation };
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
