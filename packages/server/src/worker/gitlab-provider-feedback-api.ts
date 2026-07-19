import {
  fetchWithResolvedGitProviderCa,
  type ResolvedGitProviderCa
} from "../db/services/git-provider-ca-trust";
import {
  ProviderFeedbackDeliveryError,
  ProviderFeedbackSkippedError
} from "./provider-feedback-processor";

const GITLAB_REQUEST_TIMEOUT_MS = 10_000;
const MAX_NOTE_RECOVERY_PAGES = 20;

export interface GitLabProviderFeedbackClient {
  apiBaseUrl: string;
  headers: Record<string, string>;
  ca: ResolvedGitProviderCa | null;
  signal: AbortSignal;
}

export interface GitLabCommitStatusRecord {
  id?: number | string;
}

export interface GitLabMergeRequestNoteRecord {
  id?: number | string;
  body?: string | null;
}

export function parseGitLabRetryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1_000);
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now);
}

/** GitLab project paths must be encoded as one API path parameter, including nested groups. */
export function encodeGitLabProjectPath(repositoryFullName: string) {
  const parts = repositoryFullName.trim().split("/");
  if (parts.length < 2 || parts.some((part) => part.trim().length === 0)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab feedback requires a namespace/project target.",
      retryable: false
    });
  }
  return encodeURIComponent(parts.map((part) => part.trim()).join("/"));
}

function gitLabUrl(input: GitLabProviderFeedbackClient, path: string) {
  return `${input.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

function isRetryableGitLabStatus(status: number, retryAfterMs: number | undefined) {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500 ||
    retryAfterMs !== undefined
  );
}

function boundedSignal(parentSignal: AbortSignal) {
  return AbortSignal.any([parentSignal, AbortSignal.timeout(GITLAB_REQUEST_TIMEOUT_MS)]);
}

async function requestGitLab(
  input: GitLabProviderFeedbackClient,
  path: string,
  operation: string,
  init?: RequestInit
) {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "DaoFlow",
    ...input.headers
  });
  for (const [name, value] of new Headers(init?.headers)) {
    headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetchWithResolvedGitProviderCa(input.ca, gitLabUrl(input, path), {
      ...init,
      signal: boundedSignal(input.signal),
      headers
    });
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitLab ${operation} could not be reached.`,
      retryable: true
    });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderFeedbackSkippedError(
        "GitLab API credentials do not permit deployment feedback; publication was skipped."
      );
    }
    const retryAfterMs = parseGitLabRetryAfterMs(response.headers.get("retry-after"));
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitLab ${operation} was rejected.`,
      statusCode: response.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      retryable: isRetryableGitLabStatus(response.status, retryAfterMs)
    });
  }
  return response;
}

async function responseJson<T>(response: Response, operation: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitLab ${operation} returned an invalid response.`,
      retryable: true
    });
  }
}

function requiredExternalId(value: number | string | undefined, operation: string) {
  const externalId = value === undefined || value === null ? "" : String(value).trim();
  if (!externalId) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: `GitLab ${operation} did not return an identifier.`,
      retryable: true
    });
  }
  return externalId;
}

function gitLabQuery(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

export async function setGitLabCommitStatus(input: {
  client: GitLabProviderFeedbackClient;
  repositoryPath: string;
  commitSha: string;
  state: "pending" | "running" | "success" | "failed" | "canceled";
  name: string;
  branch: string | null;
  targetUrl: string | null;
  description: string;
}) {
  const response = await requestGitLab(
    input.client,
    `/projects/${input.repositoryPath}/statuses/${encodeURIComponent(input.commitSha)}`,
    "commit status update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: input.state,
        name: input.name,
        ...(input.branch ? { ref: input.branch } : {}),
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
        description: input.description
      })
    }
  );
  const status = await responseJson<GitLabCommitStatusRecord>(response, "commit status update");
  return requiredExternalId(status.id, "commit status update");
}

export async function listGitLabMergeRequestNotes(input: {
  client: GitLabProviderFeedbackClient;
  repositoryPath: string;
  mergeRequestIid: number;
}) {
  const notes: GitLabMergeRequestNoteRecord[] = [];
  for (let page = 1; page <= MAX_NOTE_RECOVERY_PAGES; page += 1) {
    const query = gitLabQuery({ per_page: 100, page, sort: "desc" });
    const response = await requestGitLab(
      input.client,
      `/projects/${input.repositoryPath}/merge_requests/${input.mergeRequestIid}/notes?${query}`,
      "merge request note lookup"
    );
    const batch = await responseJson<unknown>(response, "merge request note lookup");
    if (!Array.isArray(batch)) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitLab merge request note lookup returned an invalid response.",
        retryable: true
      });
    }
    notes.push(...(batch as GitLabMergeRequestNoteRecord[]));
    const nextPage = response.headers.get("x-next-page");
    if (!nextPage || batch.length === 0) return notes;
  }

  throw new ProviderFeedbackDeliveryError({
    safeMessage: "GitLab merge request note recovery needs another retry.",
    retryable: true
  });
}

export async function createGitLabMergeRequestNote(input: {
  client: GitLabProviderFeedbackClient;
  repositoryPath: string;
  mergeRequestIid: number;
  body: string;
}) {
  const response = await requestGitLab(
    input.client,
    `/projects/${input.repositoryPath}/merge_requests/${input.mergeRequestIid}/notes`,
    "merge request note creation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body })
    }
  );
  const note = await responseJson<GitLabMergeRequestNoteRecord>(
    response,
    "merge request note creation"
  );
  return requiredExternalId(note.id, "merge request note creation");
}

export async function updateGitLabMergeRequestNote(input: {
  client: GitLabProviderFeedbackClient;
  repositoryPath: string;
  mergeRequestIid: number;
  noteId: string;
  body: string;
}) {
  const response = await requestGitLab(
    input.client,
    `/projects/${input.repositoryPath}/merge_requests/${input.mergeRequestIid}/notes/${encodeURIComponent(
      input.noteId
    )}`,
    "merge request note update",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body })
    }
  );
  const note = await responseJson<GitLabMergeRequestNoteRecord>(
    response,
    "merge request note update"
  );
  return requiredExternalId(note.id, "merge request note update");
}
