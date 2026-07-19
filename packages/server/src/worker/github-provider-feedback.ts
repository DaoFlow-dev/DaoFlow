import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { fetchGitHubInstallationAccessToken } from "../db/services/github-app-auth";
import { resolveGitProviderCaForProvider } from "../db/services/git-provider-ca-trust";
import { buildGitHubApiBaseUrl } from "../db/services/project-source-provider-validation-shared";
import type { ProviderFeedbackContext } from "../db/services/provider-feedback-types";
import {
  createGitHubDeployment,
  createGitHubDeploymentStatus,
  encodeGitHubRepositoryPath,
  listGitHubDeploymentStatuses,
  listGitHubDeployments,
  type GitHubProviderFeedbackClient
} from "./github-provider-feedback-api";
import { upsertGitHubPreviewComment } from "./github-provider-feedback-comment";
import {
  buildDaoFlowDeploymentUrl,
  resolveVerifiedGitHubEnvironmentUrl
} from "./github-provider-feedback-url";
import {
  registerProviderFeedbackAdapter,
  type ProviderFeedbackAdapter,
  type ProviderFeedbackAdapterInput
} from "./provider-feedback-adapter-registry";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";

type GitHubDeploymentState = "queued" | "in_progress" | "success" | "failure" | "inactive";

interface LinkedGitHubTarget {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
}

function normalizedRepositoryFullName(value: string | null) {
  const parts = value?.trim().split("/") ?? [];
  if (parts.length !== 2 || parts.some((part) => !part.trim())) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub feedback requires a linked repository.",
      retryable: false
    });
  }
  return `${parts[0].trim()}/${parts[1].trim()}`.toLowerCase();
}

function requireCommitSha(value: string | null) {
  const commitSha = value?.trim() ?? "";
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub feedback requires an immutable commit SHA.",
      retryable: false
    });
  }
  return commitSha;
}

function previewEnvironment(context: ProviderFeedbackContext) {
  const preview = context.preview;
  if (preview?.target === "pull-request" && preview.pullRequestNumber) {
    return `preview/pr-${preview.pullRequestNumber}`;
  }
  if (preview) {
    return `preview/${preview.key ?? context.deployment.environmentSlug}`;
  }
  return context.deployment.environmentName;
}

export function mapGitHubDeploymentState(input: {
  transition: string;
  context: ProviderFeedbackContext;
}): GitHubDeploymentState {
  if (input.transition === "queued") return "queued";
  if (input.transition === "failed") return "failure";
  if (input.transition === "cancelled") return "inactive";
  if (input.transition === "completed") {
    return input.context.preview?.action === "destroy" ? "inactive" : "success";
  }
  return "in_progress";
}

export function githubDeploymentMarker(deploymentId: string) {
  return `daoflow-deployment:${deploymentId}`;
}

export function githubStatusMarker(feedbackId: string) {
  return `<!-- daoflow-feedback:${feedbackId} -->`;
}

function githubStatusDescription(state: GitHubDeploymentState, feedbackId: string) {
  const label = state === "in_progress" ? "in progress" : state;
  return `DaoFlow deployment is ${label}. ${githubStatusMarker(feedbackId)}`;
}

async function loadLinkedGitHubTarget(input: ProviderFeedbackAdapterInput) {
  const installationId = input.context.repository.installationId;
  if (!installationId) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub feedback requires an active linked installation.",
      retryable: false
    });
  }

  const [target] = await db
    .select({ provider: gitProviders, installation: gitInstallations })
    .from(gitProviders)
    .innerJoin(
      gitInstallations,
      and(
        eq(gitInstallations.providerId, gitProviders.id),
        eq(gitInstallations.teamId, gitProviders.teamId)
      )
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, input.context.project.id),
        eq(projects.teamId, gitProviders.teamId),
        eq(projects.gitProviderId, gitProviders.id),
        eq(projects.gitInstallationId, gitInstallations.id)
      )
    )
    .where(
      and(
        eq(gitProviders.id, input.provider.id),
        eq(gitProviders.teamId, input.teamId),
        eq(gitProviders.type, "github"),
        eq(gitProviders.status, "active"),
        eq(gitInstallations.id, installationId),
        eq(gitInstallations.providerId, input.provider.id),
        eq(gitInstallations.status, "active")
      )
    )
    .limit(1);
  if (!target) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub feedback provider or installation is no longer active.",
      retryable: false
    });
  }
  return target satisfies LinkedGitHubTarget;
}

async function githubClient(input: ProviderFeedbackAdapterInput, target: LinkedGitHubTarget) {
  try {
    const accessToken = await fetchGitHubInstallationAccessToken({
      provider: target.provider,
      installation: target.installation
    });
    const ca = await resolveGitProviderCaForProvider(target.provider);
    return {
      apiBaseUrl: buildGitHubApiBaseUrl(target.provider.baseUrl),
      accessToken,
      ca,
      signal: input.signal
    } satisfies GitHubProviderFeedbackClient;
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub installation authentication failed.",
      retryable: true
    });
  }
}

async function findOrCreateGitHubDeployment(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  commitSha: string;
  environment: string;
  transientEnvironment: boolean;
  productionEnvironment: boolean;
  deploymentId: string;
  externalDeploymentId: string | null;
}) {
  if (input.externalDeploymentId) return input.externalDeploymentId;

  const marker = githubDeploymentMarker(input.deploymentId);
  const deployments = await listGitHubDeployments({
    client: input.client,
    repositoryPath: input.repositoryPath,
    commitSha: input.commitSha,
    environment: input.environment
  });
  const recovered = deployments.find((deployment) => deployment.payload === marker);
  if (recovered) {
    if (recovered.id === undefined || recovered.id === null) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitHub deployment recovery returned an invalid response.",
        retryable: true
      });
    }
    return String(recovered.id);
  }

  return createGitHubDeployment({
    client: input.client,
    repositoryPath: input.repositoryPath,
    commitSha: input.commitSha,
    environment: input.environment,
    transientEnvironment: input.transientEnvironment,
    productionEnvironment: input.productionEnvironment,
    marker
  });
}

async function findOrCreateGitHubStatus(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  deploymentId: string;
  feedbackId: string;
  state: GitHubDeploymentState;
  logUrl: string | null;
  environmentUrl: string | null;
}) {
  const marker = githubStatusMarker(input.feedbackId);
  const statuses = await listGitHubDeploymentStatuses({
    client: input.client,
    repositoryPath: input.repositoryPath,
    deploymentId: input.deploymentId
  });
  const recovered = statuses.find((status) => status.description?.includes(marker));
  if (recovered) {
    if (recovered.id === undefined || recovered.id === null) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitHub deployment status recovery returned an invalid response.",
        retryable: true
      });
    }
    return String(recovered.id);
  }

  return createGitHubDeploymentStatus({
    client: input.client,
    repositoryPath: input.repositoryPath,
    deploymentId: input.deploymentId,
    state: input.state,
    description: githubStatusDescription(input.state, input.feedbackId),
    logUrl: input.logUrl,
    environmentUrl: input.environmentUrl
  });
}

export const githubProviderFeedbackAdapter: ProviderFeedbackAdapter = {
  providerKind: "github",
  async upsertFeedback(input) {
    const repositoryFullName = normalizedRepositoryFullName(input.context.repository.fullName);
    const commitSha = requireCommitSha(input.context.deployment.commitSha);
    const repositoryPath = encodeGitHubRepositoryPath(repositoryFullName);
    const target = await loadLinkedGitHubTarget(input);
    const client = await githubClient(input, target);
    const state = mapGitHubDeploymentState({
      transition: input.transition,
      context: input.context
    });
    const environment = previewEnvironment(input.context);
    const externalDeploymentId = await findOrCreateGitHubDeployment({
      client,
      repositoryPath,
      commitSha,
      environment,
      transientEnvironment: input.context.preview !== null,
      productionEnvironment:
        input.context.preview === null && input.context.deployment.environmentSlug === "production",
      deploymentId: input.deploymentId,
      externalDeploymentId: input.externalIds.externalDeploymentId
    });
    const logUrl = buildDaoFlowDeploymentUrl(input.deploymentId);
    const environmentUrl = await resolveVerifiedGitHubEnvironmentUrl({
      teamId: input.teamId,
      context: input.context,
      state
    });
    const externalStatusId = await findOrCreateGitHubStatus({
      client,
      repositoryPath,
      deploymentId: externalDeploymentId,
      feedbackId: input.feedbackId,
      state,
      logUrl,
      environmentUrl
    });

    const preview = input.context.preview;
    const currentCommentId =
      preview?.target === "pull-request" && preview.pullRequestNumber
        ? await upsertGitHubPreviewComment({
            client,
            teamId: input.teamId,
            projectId: input.context.project.id,
            providerId: input.provider.id,
            repositoryFullName,
            repositoryPath,
            pullRequestNumber: preview.pullRequestNumber,
            state,
            deploymentUrl: logUrl,
            environmentUrl
          })
        : undefined;
    const externalCommentId = currentCommentId ?? input.externalIds.externalCommentId;

    return {
      externalDeploymentId,
      externalStatusId,
      ...(externalCommentId ? { externalCommentId } : {})
    };
  }
};

export function registerGitHubProviderFeedbackAdapter() {
  return registerProviderFeedbackAdapter(githubProviderFeedbackAdapter);
}
