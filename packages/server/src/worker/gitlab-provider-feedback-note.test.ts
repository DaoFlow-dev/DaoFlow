import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimProviderFeedbackPreviewComment,
  releaseProviderFeedbackPreviewComment
} from "../db/services/provider-feedback-preview-comments";
import { createProject } from "../db/services/projects";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { upsertGitLabPreviewNote } from "./gitlab-provider-feedback-note";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestUrl(input: unknown) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected a fetch request URL.");
}

function noteBody(init: unknown) {
  if (!init || typeof init !== "object") throw new Error("Expected fetch request options.");
  const body = (init as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error("Expected a string fetch request body.");
  const parsed = JSON.parse(body) as { body?: unknown };
  if (typeof parsed.body !== "string") throw new Error("Expected a note body.");
  return parsed.body;
}

async function createNoteIdentity() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectResult = await createProject({
    name: `GitLab note ${suffix}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") throw new Error("Unable to create GitLab note project.");

  return {
    teamId: "team_foundation",
    projectId: projectResult.project.id,
    providerId: `gitlab-note-provider-${suffix}`.slice(0, 32),
    repositoryFullName: "group/platform/preview-service",
    mergeRequestIid: 47
  };
}

function noteInput(identity: Awaited<ReturnType<typeof createNoteIdentity>>) {
  return {
    client: {
      apiBaseUrl: "https://gitlab.example.test/api/v4",
      headers: { "PRIVATE-TOKEN": "glpat-preview" },
      signal: new AbortController().signal
    },
    ...identity,
    repositoryPath: "group%2Fplatform%2Fpreview-service",
    state: "pending" as const,
    cleanup: false,
    deploymentUrl: "https://daoflow.example.test/deployments?deployment=dep-1",
    environmentUrl: null
  };
}

describe("GitLab provider preview notes", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers a lost create response without posting a duplicate note", async () => {
    const identity = await createNoteIdentity();
    const input = noteInput(identity);
    let createdBody = "";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json([]))
      .mockImplementationOnce((_url, init) => {
        createdBody = noteBody(init);
        return Promise.reject(new Error("note response interrupted"));
      });

    await expect(upsertGitLabPreviewNote(input)).rejects.toBeInstanceOf(
      ProviderFeedbackDeliveryError
    );
    fetchMock
      .mockResolvedValueOnce(json([{ id: 301, body: createdBody }]))
      .mockResolvedValueOnce(json({ id: 301 }));

    await expect(upsertGitLabPreviewNote(input)).resolves.toBe("301");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl(url).endsWith("/notes") && init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("recovers a missing stored note ID by finding the marker before updating", async () => {
    const identity = await createNoteIdentity();
    const claim = await claimProviderFeedbackPreviewComment({
      ...identity,
      pullRequestNumber: identity.mergeRequestIid
    });
    expect(claim).not.toBeNull();
    await expect(
      releaseProviderFeedbackPreviewComment({
        commentId: claim!.id,
        leaseToken: claim!.leaseToken,
        externalCommentId: "301"
      })
    ).resolves.toBe(true);

    const input = noteInput(identity);
    let storedBody = "";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce((_url, init) => {
        storedBody = noteBody(init);
        return Promise.resolve(json({ message: "not found" }, 404));
      })
      .mockImplementationOnce(() => Promise.resolve(json([{ id: 302, body: storedBody }])))
      .mockResolvedValueOnce(json({ id: 302 }));

    await expect(upsertGitLabPreviewNote(input)).resolves.toBe("302");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl(url).endsWith("/notes") && init?.method === "POST"
      )
    ).toHaveLength(0);
  });
});
