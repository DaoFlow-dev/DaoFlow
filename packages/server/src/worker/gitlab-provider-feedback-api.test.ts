import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeGitLabProjectPath,
  parseGitLabRetryAfterMs,
  setGitLabCommitStatus
} from "./gitlab-provider-feedback-api";
import {
  ProviderFeedbackDeliveryError,
  ProviderFeedbackSkippedError
} from "./provider-feedback-processor";

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function requestUrl(call: readonly unknown[]) {
  const input = call[0];
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected a fetch request URL.");
}

function requestJson(call: readonly unknown[]) {
  const init = call[1];
  if (!init || typeof init !== "object") throw new Error("Expected fetch request options.");
  const body = (init as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error("Expected a string fetch request body.");
  return JSON.parse(body) as Record<string, unknown>;
}

describe("GitLab provider feedback API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes nested project paths and writes a bounded stable commit status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: 701 }, 201));
    const client = {
      apiBaseUrl: "http://gitlab.internal.test/gitlab/api/v4",
      headers: { "PRIVATE-TOKEN": "glpat-token" },
      signal: new AbortController().signal
    };
    const repositoryPath = encodeGitLabProjectPath("group/platform/preview-service");
    expect(repositoryPath).toBe("group%2Fplatform%2Fpreview-service");

    await expect(
      setGitLabCommitStatus({
        client,
        repositoryPath,
        commitSha: "0123456789012345678901234567890123456789",
        state: "running",
        name: "daoflow/api/target-1",
        branch: "feature/preview",
        targetUrl: "https://daoflow.example.test/deployments?deployment=deployment-1",
        description: "DaoFlow deployment is in progress."
      })
    ).resolves.toBe("701");

    expect(requestUrl(fetchMock.mock.calls[0] ?? [])).toBe(
      "http://gitlab.internal.test/gitlab/api/v4/projects/group%2Fplatform%2Fpreview-service/statuses/0123456789012345678901234567890123456789"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(requestJson(fetchMock.mock.calls[0] ?? [])).toEqual({
      state: "running",
      name: "daoflow/api/target-1",
      ref: "feature/preview",
      target_url: "https://daoflow.example.test/deployments?deployment=deployment-1",
      description: "DaoFlow deployment is in progress."
    });
  });

  it("retries conflicts and rate limits without retaining response bodies", async () => {
    const client = {
      apiBaseUrl: "https://gitlab.com/api/v4",
      headers: { Authorization: "Bearer token" },
      signal: new AbortController().signal
    };
    const request = () =>
      setGitLabCommitStatus({
        client,
        repositoryPath: "group%2Fproject",
        commitSha: "0123456789012345678901234567890123456789",
        state: "pending",
        name: "daoflow/api/target-1",
        branch: "main",
        targetUrl: null,
        description: "DaoFlow deployment is queued."
      });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ message: "conflict" }, 409));
    await expect(request()).rejects.toMatchObject({
      safeMessage: "GitLab commit status update was rejected.",
      statusCode: 409,
      retryable: true
    } satisfies Partial<ProviderFeedbackDeliveryError>);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({ message: "slow down" }, 429, { "Retry-After": "30" })
    );
    await expect(request()).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 30_000,
      retryable: true
    } satisfies Partial<ProviderFeedbackDeliveryError>);
    expect(parseGitLabRetryAfterMs("Wed, 01 Jan 2020 00:00:10 GMT", Date.UTC(2020, 0, 1))).toBe(
      10_000
    );
  });

  it("records rejected credentials as a safe capability skip", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "forbidden" }, 403));

    await expect(
      setGitLabCommitStatus({
        client: {
          apiBaseUrl: "https://gitlab.com/api/v4",
          headers: { "PRIVATE-TOKEN": "revoked-token" },
          signal: new AbortController().signal
        },
        repositoryPath: "group%2Fproject",
        commitSha: "0123456789012345678901234567890123456789",
        state: "pending",
        name: "daoflow/api/target-1",
        branch: "main",
        targetUrl: null,
        description: "DaoFlow deployment is queued."
      })
    ).rejects.toMatchObject({
      safeMessage:
        "GitLab API credentials do not permit deployment feedback; publication was skipped."
    } satisfies Partial<ProviderFeedbackSkippedError>);
  });
});
