import {
  fetchWithResolvedGitProviderCa,
  type ResolvedGitProviderCa
} from "../db/services/git-provider-ca-trust";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";

const GITHUB_ACCEPT = "application/vnd.github+json";
const MAX_COMMENT_RECOVERY_PAGES = 20;

export interface GitHubProviderFeedbackClient {
  apiBaseUrl: string;
  accessToken: string;
  ca: ResolvedGitProviderCa | null;
  signal: AbortSignal;
}

export interface GitHubDeploymentRecord {
  id?: number | string;
  payload?: unknown;
}

export interface GitHubDeploymentStatusRecord {
  id?: number | string;
  description?: string | null;
}

export interface GitHubIssueCommentRecord {
  id?: number | string;
  body?: string | null;
}

export function parseGitHubRetryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1_000);
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
}

export function encodeGitHubRepositoryPath(repositoryFullName: string) {
  const parts = repositoryFullName.trim().split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub feedback requires an owner/repository target.",
      retryable: false
    });
  }
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function githubUrl(input: GitHubProviderFeedbackClient, path: string) {
  return `${input.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

function isRetryableGitHubStatus(status: number, retryAfterMs: number | undefined) {
  return status === 408 || status === 429 || status >= 500 || retryAfterMs !== undefined;
}

async function requestGitHub(
  input: GitHubProviderFeedbackClient,
  path: string,
  operation: string,
  init?: RequestInit
) {
  let response: Response;
  try {
    response = await fetchWithResolvedGitProviderCa(input.ca, githubUrl(input, path), {
      ...init,
      signal: input.signal,
      headers: {
        Accept: GITHUB_ACCEPT,
        Authorization: `Bearer ${input.accessToken}`,
        "User-Agent": "DaoFlow",
        ...init?.headers
      }
    });
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitHub ${operation} could not be reached.`,
      retryable: true
    });
  }

  if (!response.ok) {
    const retryAfterMs = parseGitHubRetryAfterMs(response.headers.get("retry-after"));
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitHub ${operation} was rejected.`,
      statusCode: response.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      retryable: isRetryableGitHubStatus(response.status, retryAfterMs)
    });
  }
  return response;
}

async function responseJson<T>(response: Response, operation: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitHub ${operation} returned an invalid response.`,
      retryable: true
    });
  }
}

function requiredExternalId(value: number | string | undefined, operation: string) {
  const externalId = value === undefined || value === null ? "" : String(value).trim();
  if (!externalId) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitHub ${operation} did not return an identifier.`,
      retryable: true
    });
  }
  return externalId;
}

function githubQuery(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

export async function listGitHubDeployments(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  commitSha: string;
  environment: string;
}) {
  const query = githubQuery({
    sha: input.commitSha,
    environment: input.environment,
    per_page: 100
  });
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/deployments?${query}`,
    "deployment lookup"
  );
  const deployments = await responseJson<unknown>(response, "deployment lookup");
  if (!Array.isArray(deployments)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub deployment lookup returned an invalid response.",
      retryable: true
    });
  }
  return deployments as GitHubDeploymentRecord[];
}

export async function createGitHubDeployment(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  commitSha: string;
  environment: string;
  transientEnvironment: boolean;
  productionEnvironment: boolean;
  marker: string;
}) {
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/deployments`,
    "deployment creation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: input.commitSha,
        environment: input.environment,
        transient_environment: input.transientEnvironment,
        production_environment: input.productionEnvironment,
        auto_merge: false,
        required_contexts: [],
        payload: input.marker
      })
    }
  );
  const deployment = await responseJson<GitHubDeploymentRecord>(response, "deployment creation");
  return requiredExternalId(deployment.id, "deployment creation");
}

export async function listGitHubDeploymentStatuses(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  deploymentId: string;
}) {
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/deployments/${encodeURIComponent(input.deploymentId)}/statuses?per_page=100`,
    "deployment status lookup"
  );
  const statuses = await responseJson<unknown>(response, "deployment status lookup");
  if (!Array.isArray(statuses)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub deployment status lookup returned an invalid response.",
      retryable: true
    });
  }
  return statuses as GitHubDeploymentStatusRecord[];
}

export async function createGitHubDeploymentStatus(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  deploymentId: string;
  state: "queued" | "in_progress" | "success" | "failure" | "inactive";
  description: string;
  logUrl: string | null;
  environmentUrl: string | null;
}) {
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/deployments/${encodeURIComponent(input.deploymentId)}/statuses`,
    "deployment status update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: input.state,
        description: input.description,
        ...(input.logUrl ? { log_url: input.logUrl } : {}),
        ...(input.environmentUrl ? { environment_url: input.environmentUrl } : {})
      })
    }
  );
  const status = await responseJson<GitHubDeploymentStatusRecord>(
    response,
    "deployment status update"
  );
  return requiredExternalId(status.id, "deployment status update");
}

export async function listGitHubIssueComments(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  pullRequestNumber: number;
}) {
  const comments: GitHubIssueCommentRecord[] = [];
  for (let page = 1; page <= MAX_COMMENT_RECOVERY_PAGES; page += 1) {
    const query = githubQuery({ per_page: 100, page, sort: "created", direction: "desc" });
    const response = await requestGitHub(
      input.client,
      `/repos/${input.repositoryPath}/issues/${input.pullRequestNumber}/comments?${query}`,
      "preview comment lookup"
    );
    const batch = await responseJson<unknown>(response, "preview comment lookup");
    if (!Array.isArray(batch)) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitHub preview comment lookup returned an invalid response.",
        retryable: true
      });
    }
    comments.push(...(batch as GitHubIssueCommentRecord[]));
    if (batch.length < 100) return comments;
  }

  throw new ProviderFeedbackDeliveryError({
    safeMessage: "GitHub preview comment recovery needs another retry.",
    retryable: true
  });
}

export async function createGitHubIssueComment(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  pullRequestNumber: number;
  body: string;
}) {
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/issues/${input.pullRequestNumber}/comments`,
    "preview comment creation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body })
    }
  );
  const comment = await responseJson<GitHubIssueCommentRecord>(
    response,
    "preview comment creation"
  );
  return requiredExternalId(comment.id, "preview comment creation");
}

export async function updateGitHubIssueComment(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  commentId: string;
  body: string;
}) {
  const response = await requestGitHub(
    input.client,
    `/repos/${input.repositoryPath}/issues/comments/${encodeURIComponent(input.commentId)}`,
    "preview comment update",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body })
    }
  );
  const comment = await responseJson<GitHubIssueCommentRecord>(response, "preview comment update");
  return requiredExternalId(comment.id, "preview comment update");
}
