import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimProviderFeedbackPreviewComment,
  releaseProviderFeedbackPreviewComment
} from "../db/services/provider-feedback-preview-comments";
import { createProject } from "../db/services/projects";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { upsertGitHubPreviewComment } from "./github-provider-feedback-comment";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestBody(init: unknown) {
  if (!init || typeof init !== "object") throw new Error("Expected fetch request options.");
  const body = (init as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error("Expected a string fetch request body.");
  return body;
}

function requestUrl(input: unknown) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected a fetch request URL.");
}

function commentBody(init: unknown) {
  const parsed = JSON.parse(requestBody(init)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Expected a JSON request body.");
  const body = (parsed as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error("Expected a comment body.");
  return body;
}

async function createCommentIdentity() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectResult = await createProject({
    name: `GitHub comment ${suffix}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") throw new Error("Unable to create GitHub comment project.");

  return {
    teamId: "team_foundation",
    projectId: projectResult.project.id,
    providerId: `github-comment-provider-${suffix}`.slice(0, 32),
    repositoryFullName: "example/preview-service",
    pullRequestNumber: 47
  };
}

describe("GitHub provider preview comments", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers an uncertain creation without posting a duplicate", async () => {
    const identity = await createCommentIdentity();
    let remoteBody = "";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json([]))
      .mockImplementationOnce((_url, init) => {
        remoteBody = commentBody(init);
        return Promise.reject(new Error("comment response interrupted"));
      });
    const input = {
      client: {
        apiBaseUrl: "https://api.github.com",
        accessToken: "ghs_installation",
        signal: new AbortController().signal
      },
      ...identity,
      repositoryPath: "example/preview-service",
      state: "queued" as const,
      deploymentUrl: "https://daoflow.example.test/deployments?deployment=dep-1",
      environmentUrl: null
    };

    await expect(upsertGitHubPreviewComment(input)).rejects.toBeInstanceOf(
      ProviderFeedbackDeliveryError
    );
    fetchMock
      .mockResolvedValueOnce(json([{ id: 301, body: remoteBody }]))
      .mockResolvedValueOnce(json({ id: 301 }));

    await expect(upsertGitHubPreviewComment(input)).resolves.toBe("301");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl(url).endsWith("/comments") && init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("keeps one identity when a project changes GitHub Apps", async () => {
    const identity = await createCommentIdentity();
    const first = await claimProviderFeedbackPreviewComment(identity);
    expect(first).not.toBeNull();
    await expect(
      releaseProviderFeedbackPreviewComment({
        commentId: first!.id,
        leaseToken: first!.leaseToken,
        externalCommentId: "301"
      })
    ).resolves.toBe(true);

    const second = await claimProviderFeedbackPreviewComment({
      ...identity,
      providerId: "replacement-github-provider"
    });
    expect(second).toMatchObject({ id: first!.id, externalCommentId: "301" });
    await expect(
      releaseProviderFeedbackPreviewComment({
        commentId: second!.id,
        leaseToken: second!.leaseToken
      })
    ).resolves.toBe(true);
  });
});
