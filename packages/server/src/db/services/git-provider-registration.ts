import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import { createGitLabCredentialStorage } from "./gitlab-credentials";
import { validateGitLabApiToken } from "./gitlab-installation-auth";
import { gitLabBaseUrlHost, normalizeGitLabBaseUrl } from "./gitlab-urls";
import { newId as id } from "./json-helpers";
import { toGitProviderSummary } from "./git-provider-summaries";

export type RegisterGitLabCredential =
  | { kind: "oauth" }
  | { kind: "api_token"; token: string; expiresAt?: string }
  | { kind: "deploy_token"; username: string; token: string; expiresAt?: string };

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
  internalBaseUrl?: string;
  gitlabCredential?: RegisterGitLabCredential;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

type StaticGitLabInstallation = {
  installationId: string;
  accountName: string;
  accountType: "user" | "deploy_token";
  credential: ReturnType<typeof createGitLabCredentialStorage>;
};

function requireGitLabOAuthClient(input: RegisterGitProviderInput) {
  if (!input.clientId?.trim() || !input.clientSecret?.trim()) {
    throw new Error("GitLab OAuth registration requires a client ID and client secret.");
  }
}

function normalizeGitLabProviderUrls(input: RegisterGitProviderInput) {
  if (input.type !== "gitlab") {
    return {
      baseUrl: input.baseUrl ?? null,
      internalBaseUrl: input.internalBaseUrl ?? null
    };
  }
  return {
    baseUrl: input.baseUrl ? normalizeGitLabBaseUrl(input.baseUrl) : null,
    internalBaseUrl: input.internalBaseUrl ? normalizeGitLabBaseUrl(input.internalBaseUrl) : null
  };
}

async function prepareStaticGitLabInstallation(input: {
  credential: RegisterGitLabCredential;
  baseUrl: string | null;
  internalBaseUrl: string | null;
}): Promise<StaticGitLabInstallation | null> {
  if (input.credential.kind === "oauth") return null;

  if (input.credential.kind === "api_token") {
    const user = await validateGitLabApiToken({
      baseUrl: input.baseUrl,
      internalBaseUrl: input.internalBaseUrl,
      token: input.credential.token
    });
    return {
      installationId: user.id,
      accountName: user.username,
      accountType: "user",
      credential: createGitLabCredentialStorage(input.credential)
    };
  }

  return {
    installationId: `deploy_${id()}`.slice(0, 40),
    accountName: "Deploy token",
    accountType: "deploy_token",
    credential: createGitLabCredentialStorage(input.credential)
  };
}

function credentialAuditMetadata(input: {
  credential?: RegisterGitLabCredential;
  baseUrl: string | null;
  internalBaseUrl: string | null;
}) {
  if (!input.credential) return {};
  const scopes =
    input.credential.kind === "deploy_token" ? ["read_repository"] : ["api", "read_repository"];
  const credentialExpiresAt =
    input.credential.kind === "oauth" ? null : (input.credential.expiresAt ?? null);
  return {
    credentialKind: input.credential.kind,
    credentialScopes: scopes,
    credentialExpiresAt,
    publicHost: gitLabBaseUrlHost(input.baseUrl),
    internalHost: gitLabBaseUrlHost(input.internalBaseUrl ?? input.baseUrl)
  };
}

export async function registerGitProvider(input: RegisterGitProviderInput) {
  if (input.type === "gitlab" && input.gitlabCredential?.kind === "oauth") {
    requireGitLabOAuthClient(input);
  }

  const urls = normalizeGitLabProviderUrls(input);
  const staticInstallation =
    input.type === "gitlab" && input.gitlabCredential
      ? await prepareStaticGitLabInstallation({
          credential: input.gitlabCredential,
          baseUrl: urls.baseUrl,
          internalBaseUrl: urls.internalBaseUrl
        })
      : null;
  const providerId = id();
  const auditCredential = credentialAuditMetadata({
    credential: input.gitlabCredential,
    baseUrl: urls.baseUrl,
    internalBaseUrl: urls.internalBaseUrl
  });

  const result = await db.transaction(async (tx) => {
    const [provider] = await tx
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
        baseUrl: urls.baseUrl,
        internalBaseUrl: urls.internalBaseUrl,
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    if (!provider) throw new Error("Expected git provider write to return a row.");

    await tx.insert(auditEntries).values({
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
        providerType: input.type,
        ...auditCredential
      }
    });

    if (staticInstallation) {
      const installationId = id();
      const [installation] = await tx
        .insert(gitInstallations)
        .values({
          id: installationId,
          teamId: input.teamId,
          providerId,
          installationId: staticInstallation.installationId,
          accountName: staticInstallation.accountName,
          accountType: staticInstallation.accountType,
          repositorySelection: "all",
          ...staticInstallation.credential,
          status: "active",
          installedByUserId: input.requestedByUserId,
          updatedAt: new Date()
        })
        .returning();
      if (!installation) throw new Error("Expected GitLab installation write to return a row.");

      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: input.requestedByUserId,
        actorEmail: input.requestedByEmail,
        actorRole: input.requestedByRole,
        targetResource: `git_installation/${installation.id}`,
        action: "git_installation.create",
        inputSummary: `Installed ${installation.accountName} (${input.gitlabCredential?.kind ?? "gitlab"})`,
        permissionScope: "server:write",
        outcome: "success",
        metadata: {
          resourceType: "git_installation",
          resourceId: installation.id,
          teamId: input.teamId,
          providerId,
          externalInstallationId: installation.installationId,
          ...auditCredential
        }
      });
    }

    return provider;
  });

  return { status: "ok" as const, provider: result, summary: toGitProviderSummary(result) };
}
