import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitLabCommitStatusName,
  gitLabProviderFeedbackAdapter,
  mapGitLabCommitStatusState
} from "./gitlab-provider-feedback";
import { createGitLabProviderFeedbackFixture } from "./gitlab-provider-feedback-fixtures";
import { ProviderFeedbackSkippedError } from "./provider-feedback-processor";
import { resetTestDatabaseWithControlPlane } from "../test-db";

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

function requestHeaders(call: readonly unknown[]) {
  const init = call[1];
  if (!init || typeof init !== "object") throw new Error("Expected fetch request options.");
  return new Headers((init as RequestInit).headers);
}

describe("GitLab provider feedback", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("uses stable statuses and exactly one durable merge-request note", async () => {
    const fixture = await createGitLabProviderFeedbackFixture();
    const queued = fixture.createInput();
    const running = fixture.createInput({ transition: "running", feedbackId: "feedback-running" });
    const success = fixture.createInput({
      transition: "completed",
      feedbackId: "feedback-success"
    });
    const failed = fixture.createInput({ transition: "failed", feedbackId: "feedback-failed" });
    const cleanup = fixture.createInput({
      feedbackId: "feedback-cleanup",
      targetId: "target-cleanup",
      deploymentId: "deployment-cleanup",
      transition: "completed",
      context: {
        ...queued.context,
        preview: { ...queued.context.preview!, action: "destroy" }
      }
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ id: 201 }, 201))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 301 }, 201))
      .mockResolvedValueOnce(json({ id: 202 }, 201))
      .mockResolvedValueOnce(json({ id: 301 }))
      .mockResolvedValueOnce(json({ id: 203 }, 201))
      .mockResolvedValueOnce(json({ id: 301 }))
      .mockResolvedValueOnce(json({ id: 204 }, 201))
      .mockResolvedValueOnce(json({ id: 301 }))
      .mockResolvedValueOnce(json({ id: 205 }, 201))
      .mockResolvedValueOnce(json({ id: 301 }));

    await expect(gitLabProviderFeedbackAdapter.upsertFeedback(queued)).resolves.toEqual({
      externalStatusId: "201",
      externalCommentId: "301"
    });
    await expect(gitLabProviderFeedbackAdapter.upsertFeedback(running)).resolves.toMatchObject({
      externalStatusId: "202",
      externalCommentId: "301"
    });
    await expect(gitLabProviderFeedbackAdapter.upsertFeedback(success)).resolves.toMatchObject({
      externalStatusId: "203",
      externalCommentId: "301"
    });
    await expect(gitLabProviderFeedbackAdapter.upsertFeedback(failed)).resolves.toMatchObject({
      externalStatusId: "204",
      externalCommentId: "301"
    });
    await expect(gitLabProviderFeedbackAdapter.upsertFeedback(cleanup)).resolves.toMatchObject({
      externalStatusId: "205",
      externalCommentId: "301"
    });

    const statusCalls = fetchMock.mock.calls.filter(([url]) =>
      requestUrl([url]).includes("/statuses/")
    );
    expect(statusCalls).toHaveLength(5);
    expect(requestUrl(statusCalls[0] ?? [])).toBe(
      "http://gitlab.internal.test/gitlab/api/v4/projects/group%2Fplatform%2Fpreview-service/statuses/0123456789012345678901234567890123456789"
    );
    const statusBodies = statusCalls.map((call) => requestJson(call));
    expect(statusBodies.map((body) => body.state)).toEqual([
      "pending",
      "running",
      "success",
      "failed",
      "success"
    ]);
    expect(statusBodies.slice(0, 4).map((body) => body.name)).toEqual([
      gitLabCommitStatusName({ targetId: queued.targetId, serviceName: "api" }),
      gitLabCommitStatusName({ targetId: queued.targetId, serviceName: "api" }),
      gitLabCommitStatusName({ targetId: queued.targetId, serviceName: "api" }),
      gitLabCommitStatusName({ targetId: queued.targetId, serviceName: "api" })
    ]);
    expect(statusBodies[0]).toMatchObject({
      ref: "feature/preview",
      target_url: `https://daoflow.example.test/deployments?deployment=${queued.deploymentId}`
    });
    expect(requestHeaders(statusCalls[0] ?? []).get("PRIVATE-TOKEN")).toBe("glpat-feedback-token");

    const noteWrites = fetchMock.mock.calls.filter(
      ([url, init]) =>
        requestUrl([url]).includes("/merge_requests/47/notes") && init?.method !== undefined
    );
    expect(noteWrites.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(noteWrites.filter(([, init]) => init?.method === "PUT")).toHaveLength(4);
    const noteBodies = noteWrites.map(([, init]) => requestJson(["", init]));
    expect(noteBodies[0]?.body).not.toContain(fixture.domain);
    expect(noteBodies[2]?.body).toContain(`https://${fixture.domain}`);
    expect(noteBodies[3]?.body).not.toContain(fixture.domain);
    expect(noteBodies[4]?.body).toContain("Status: cleaned up");
    expect(noteBodies[4]?.body).not.toContain(fixture.domain);
    expect(statusBodies[4]?.description).toBe("DaoFlow preview is cleaned up.");
  });

  it("refreshes OAuth before publishing with the rotated bearer token", async () => {
    const fixture = await createGitLabProviderFeedbackFixture({
      credentialKind: "oauth",
      preview: "none"
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          created_at: Math.floor(Date.now() / 1000)
        })
      )
      .mockResolvedValueOnce(json({ id: 501 }, 201));

    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(fixture.createInput())
    ).resolves.toEqual({ externalStatusId: "501" });
    expect(requestUrl(fetchMock.mock.calls[0] ?? [])).toBe(
      "http://gitlab.internal.test/gitlab/oauth/token"
    );
    expect(requestHeaders(fetchMock.mock.calls[1] ?? []).get("Authorization")).toBe(
      "Bearer rotated-access-token"
    );
  });

  it("uses the public GitLab.com API when no internal route is configured", async () => {
    const fixture = await createGitLabProviderFeedbackFixture({
      host: "gitlab.com",
      preview: "none"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: 601 }, 201));

    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(fixture.createInput())
    ).resolves.toEqual({ externalStatusId: "601" });
    expect(requestUrl(fetchMock.mock.calls[0] ?? [])).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fplatform%2Fpreview-service/statuses/0123456789012345678901234567890123456789"
    );
  });

  it("publishes only a commit status for pushes and branch previews", async () => {
    const pushFixture = await createGitLabProviderFeedbackFixture({ preview: "none" });
    const branchFixture = await createGitLabProviderFeedbackFixture({ preview: "branch" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ id: 401 }, 201))
      .mockResolvedValueOnce(json({ id: 402 }, 201));

    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(pushFixture.createInput())
    ).resolves.toEqual({
      externalStatusId: "401"
    });
    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(branchFixture.createInput())
    ).resolves.toEqual({ externalStatusId: "402" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => !requestUrl([url]).includes("/notes"))).toBe(true);
  });

  it("skips clone-only credentials without calling GitLab", async () => {
    const fixture = await createGitLabProviderFeedbackFixture({ credentialKind: "deploy_token" });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(fixture.createInput())
    ).rejects.toMatchObject({
      safeMessage:
        "GitLab deploy-token credentials are clone-only; commit status and merge-request feedback were skipped."
    } satisfies Partial<ProviderFeedbackSkippedError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips missing API credentials without calling GitLab", async () => {
    const fixture = await createGitLabProviderFeedbackFixture({ credentialKind: "unavailable" });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      gitLabProviderFeedbackAdapter.upsertFeedback(fixture.createInput())
    ).rejects.toMatchObject({
      safeMessage:
        "GitLab API-capable credentials are unavailable; commit status and merge-request feedback were skipped."
    } satisfies Partial<ProviderFeedbackSkippedError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps every publishable deployment transition to the GitLab status contract", async () => {
    const context = (await createGitLabProviderFeedbackFixture()).createInput().context;
    expect(
      [
        "queued",
        "waiting",
        "prepare",
        "deploy",
        "finalize",
        "running",
        "completed",
        "failed",
        "cancelled"
      ].map((transition) => mapGitLabCommitStatusState({ transition, context }))
    ).toEqual([
      "pending",
      "running",
      "running",
      "running",
      "running",
      "running",
      "success",
      "failed",
      "canceled"
    ]);
  });
});
