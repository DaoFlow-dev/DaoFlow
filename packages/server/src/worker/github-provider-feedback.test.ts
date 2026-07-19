import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import { tunnelRoutes, tunnels } from "../db/schema/tunnels";
import { createEnvironment, createProject } from "../db/services/projects";
import type { ProviderFeedbackContext } from "../db/services/provider-feedback-types";
import type { ProviderFeedbackAdapterInput } from "./provider-feedback-adapter-registry";
import {
  githubDeploymentMarker,
  githubProviderFeedbackAdapter,
  githubStatusMarker,
  mapGitHubDeploymentState
} from "./github-provider-feedback";
import { resolveVerifiedGitHubEnvironmentUrl } from "./github-provider-feedback-url";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";
import { resetTestDatabaseWithControlPlane } from "../test-db";

const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs1" })
  .toString();
let fixtureCounter = 0;

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function requestBody(call: readonly unknown[]) {
  const init = call[1];
  if (!init || typeof init !== "object") throw new Error("Expected fetch request options.");
  const body = (init as { body?: unknown }).body;
  if (typeof body !== "string") throw new Error("Expected a string fetch request body.");
  return body;
}

function requestJson(call: readonly unknown[]) {
  const parsed = JSON.parse(requestBody(call)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Expected a JSON request body.");
  return parsed as Record<string, unknown>;
}

function requestUrl(call: readonly unknown[]) {
  const input = call[0];
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected a fetch request URL.");
}

async function createFixture(input?: { baseUrl?: string | null; preview?: boolean }) {
  fixtureCounter += 1;
  const suffix = `${Date.now()}-${fixtureCounter}`;
  const providerId = `gh-provider-${suffix}`.slice(0, 32);
  const installationId = `gh-install-${suffix}`.slice(0, 32);
  const tunnelId = `gh-tunnel-${suffix}`.slice(0, 32);
  const serviceId = `gh-service-${suffix}`.slice(0, 32);
  const domain = `pr-${fixtureCounter}.preview.example.test`;
  const projectResult = await createProject({
    name: `GitHub feedback ${suffix}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") throw new Error("Unable to create GitHub feedback project.");
  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `Preview ${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok")
    throw new Error("Unable to create GitHub feedback environment.");

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "github",
    name: `GitHub feedback ${suffix}`,
    appId: "123456",
    privateKeyEncrypted: encrypt(privateKeyPem),
    baseUrl: input?.baseUrl ?? null,
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: "9001",
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    status: "active",
    updatedAt: new Date()
  });
  await db
    .update(projects)
    .set({
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example/preview-service",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));
  await db.insert(services).values({
    id: serviceId,
    name: "api",
    slug: `api-${fixtureCounter}`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    targetServerId: "srv_foundation_1",
    config: {},
    updatedAt: new Date()
  });
  await db.insert(tunnels).values({
    id: tunnelId,
    name: `GitHub feedback ${suffix}`,
    teamId: "team_foundation",
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(tunnelRoutes).values({
    id: `gh-route-${suffix}`.slice(0, 32),
    tunnelId,
    hostname: domain,
    service: "api",
    status: "active",
    updatedAt: new Date()
  });

  const preview =
    input?.preview === false
      ? null
      : {
          target: "pull-request" as const,
          action: "deploy" as const,
          key: "pr-47",
          branch: "feature/preview",
          pullRequestNumber: 47,
          primaryDomain: domain
        };
  const createInput = (
    overrides?: Partial<ProviderFeedbackAdapterInput>
  ): ProviderFeedbackAdapterInput => ({
    feedbackId: `feedback-${suffix}`.slice(0, 32),
    targetId: `target-${suffix}`.slice(0, 32),
    idempotencyKey: `deployment-${suffix}:queued`,
    teamId: "team_foundation",
    deploymentId: `deployment-${suffix}`.slice(0, 32),
    transition: "queued",
    provider: { id: providerId, kind: "github" },
    context: {
      schemaVersion: 1,
      project: { id: projectResult.project.id, name: projectResult.project.name },
      repository: { fullName: "example/preview-service", installationId },
      deployment: {
        commitSha: "0123456789012345678901234567890123456789",
        branch: "feature/preview",
        serviceName: "api",
        environmentId: environmentResult.environment.id,
        environmentName: environmentResult.environment.name,
        environmentSlug: environmentResult.environment.slug ?? "preview"
      },
      preview
    },
    externalIds: {
      externalDeploymentId: null,
      externalStatusId: null,
      externalCommentId: null
    },
    attemptCount: 1,
    signal: new AbortController().signal,
    ...overrides
  });

  return { createInput, domain, routeId: `gh-route-${suffix}`.slice(0, 32) };
}

describe("GitHub provider feedback", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("uses one durable preview comment and only adds a verified success URL", async () => {
    const fixture = await createFixture();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 101 }, 201))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 201 }, 201))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 301 }, 201));

    const queued = await githubProviderFeedbackAdapter.upsertFeedback(fixture.createInput());
    expect(queued).toEqual({
      externalDeploymentId: "101",
      externalStatusId: "201",
      externalCommentId: "301"
    });

    const queuedStatus = requestJson(fetchMock.mock.calls[4] ?? []);
    expect(queuedStatus).toMatchObject({
      state: "queued",
      log_url:
        "https://daoflow.example.test/deployments?deployment=" + fixture.createInput().deploymentId
    });
    expect(queuedStatus).not.toHaveProperty("environment_url");
    expect(requestBody(fetchMock.mock.calls[6] ?? [])).not.toContain(fixture.domain);

    const successful = fixture.createInput({
      feedbackId: "feedback-success",
      deploymentId: "deployment-success",
      transition: "completed"
    });
    fetchMock
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 102 }, 201))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 202 }, 201))
      .mockResolvedValueOnce(json({ id: 301 }));

    await expect(githubProviderFeedbackAdapter.upsertFeedback(successful)).resolves.toMatchObject({
      externalDeploymentId: "102",
      externalStatusId: "202",
      externalCommentId: "301"
    });
    const successStatus = requestJson(fetchMock.mock.calls[11] ?? []);
    expect(successStatus.environment_url).toBe(`https://${fixture.domain}`);
    expect(requestBody(fetchMock.mock.calls[12] ?? [])).toContain(`https://${fixture.domain}`);
    expect(fetchMock.mock.calls[12]?.[1]?.method).toBe("PATCH");

    const replacement = fixture.createInput({
      feedbackId: "feedback-comment-replacement",
      deploymentId: "deployment-success",
      transition: "failed",
      externalIds: {
        externalDeploymentId: "102",
        externalStatusId: "202",
        externalCommentId: "301"
      }
    });
    fetchMock
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 203 }, 201))
      .mockResolvedValueOnce(json({ message: "not found" }, 404))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 302 }, 201));

    await expect(githubProviderFeedbackAdapter.upsertFeedback(replacement)).resolves.toEqual({
      externalDeploymentId: "102",
      externalStatusId: "203",
      externalCommentId: "301"
    });
    expect(fetchMock.mock.calls[18]?.[1]?.method).toBe("POST");

    await db
      .update(tunnelRoutes)
      .set({ status: "inactive" })
      .where(eq(tunnelRoutes.id, fixture.routeId));
    await expect(
      resolveVerifiedGitHubEnvironmentUrl({
        teamId: "team_foundation",
        context: successful.context,
        state: "success"
      })
    ).resolves.toBeNull();
  });

  it("recovers remote deployment and status writes after an uncertain outcome", async () => {
    const fixture = await createFixture({ preview: false });
    const input = fixture.createInput({
      feedbackId: "feedback-retry",
      deploymentId: "deployment-retry"
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(json([]))
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(
        json([{ id: 401, payload: githubDeploymentMarker(input.deploymentId) }])
      )
      .mockResolvedValueOnce(json([]))
      .mockRejectedValueOnce(new Error("status response interrupted"))
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(
        json([{ id: 401, payload: githubDeploymentMarker(input.deploymentId) }])
      )
      .mockResolvedValueOnce(
        json([{ id: 501, description: githubStatusMarker(input.feedbackId) }])
      );

    await expect(githubProviderFeedbackAdapter.upsertFeedback(input)).rejects.toBeInstanceOf(
      ProviderFeedbackDeliveryError
    );
    await expect(githubProviderFeedbackAdapter.upsertFeedback(input)).rejects.toBeInstanceOf(
      ProviderFeedbackDeliveryError
    );
    await expect(githubProviderFeedbackAdapter.upsertFeedback(input)).resolves.toMatchObject({
      externalDeploymentId: "401",
      externalStatusId: "501"
    });
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl([url]).endsWith("/deployments") && init?.method === "POST"
      )
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl([url]).endsWith("/statuses") && init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("safely omits environment URLs for feedback queued before service names were captured", async () => {
    const fixture = await createFixture();
    const context = fixture.createInput().context;
    const { serviceName: _serviceName, ...legacyDeployment } = context.deployment;
    const legacyContext = {
      ...context,
      deployment: legacyDeployment
    } as ProviderFeedbackContext;

    await expect(
      resolveVerifiedGitHubEnvironmentUrl({
        teamId: "team_foundation",
        context: legacyContext,
        state: "success"
      })
    ).resolves.toBeNull();
  });

  it("uses the configured GitHub Enterprise API and preserves rate-limit retry data", async () => {
    const fixture = await createFixture({
      baseUrl: "https://github.enterprise.test"
    });
    const input = fixture.createInput();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ token: "ghs_installation" }))
      .mockResolvedValueOnce(json({ message: "slow down" }, 429, { "Retry-After": "30" }));

    await expect(githubProviderFeedbackAdapter.upsertFeedback(input)).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 30_000,
      retryable: true
    });
    expect(requestUrl(fetchMock.mock.calls[1] ?? [])).toMatch(
      /^https:\/\/github\.enterprise\.test\/api\/v3\/repos\/example\/preview-service\/deployments\?/
    );
    expect(
      mapGitHubDeploymentState({
        transition: "completed",
        context: { ...input.context, preview: { ...input.context.preview!, action: "destroy" } }
      })
    ).toBe("inactive");
  });
});
