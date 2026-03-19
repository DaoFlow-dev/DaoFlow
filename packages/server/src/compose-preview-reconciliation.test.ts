import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "./context";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { events } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { tunnelRoutes, tunnels } from "./db/schema/tunnels";
import { ensureControlPlaneReady } from "./db/services/seed";
import { createEnvironment, createProject } from "./db/services/projects";
import { asRecord } from "./db/services/json-helpers";
import { createService } from "./db/services/services";
import { readComposePreviewMetadata } from "./compose-preview";
import { appRouter } from "./router";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function mockGitHubSourceFetch(input: {
  repoFullName: string;
  installationId: string;
  branch?: string;
  composePath?: string;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/app/installations/${input.installationId}/access_tokens`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ token: "ghs_router_preview_validation" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/repos/${input.repoFullName}`)) {
      return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    }

    if (url.endsWith(`/repos/${input.repoFullName}/branches/${encodeURIComponent(branch)}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }

    if (
      url.includes(
        `/repos/${input.repoFullName}/contents/${encodedComposePath}?ref=${encodeURIComponent(branch)}`
      )
    ) {
      return Promise.resolve(new Response(JSON.stringify({ path: composePath }), { status: 200 }));
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

function makeSession(role: string): NonNullable<Context["session"]> {
  const seededUsers = {
    owner: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    },
    viewer: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    }
  } as const;
  const actor = seededUsers[role as keyof typeof seededUsers] ?? seededUsers.viewer;

  return {
    user: {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role
    },
    session: {
      id: `session_${role}`,
      userId: actor.id,
      expiresAt: new Date(),
      token: `token_${role}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as NonNullable<Context["session"]>;
}

describe("compose preview reconciliation", () => {
  beforeEach(async () => {
    await ensureControlPlaneReady();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports preview domain drift and stale preview eligibility", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-preview-reconciliation",
      session: makeSession("viewer")
    });

    const projectResult = await createProject({
      name: `preview-reconcile-${Date.now()}`,
      description: "Preview reconciliation fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create preview reconciliation fixture project.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `preview-reconcile-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create preview reconciliation fixture environment.");
    }

    const serviceResult = await createService({
      name: `preview-reconcile-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      preview: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "preview-{pr}.example.test",
        staleAfterHours: 1
      },
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create preview reconciliation fixture service.");
    }

    const now = Date.now();
    await db.insert(deployments).values([
      {
        id: `depprevstale_${now}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "deploy",
            key: "pr-41",
            branch: "feature/stale",
            pullRequestNumber: 41,
            envBranch: "preview/pr-41",
            stackName: "preview-pr-41",
            primaryDomain: "preview-41.example.test"
          }
        },
        updatedAt: new Date(now - 4 * 60 * 60 * 1000),
        createdAt: new Date(now - 4 * 60 * 60 * 1000),
        concludedAt: new Date(now - 4 * 60 * 60 * 1000 + 15_000)
      },
      {
        id: `depprevorphan_${now}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose",
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "destroy",
            key: "pr-42",
            branch: "feature/orphaned",
            pullRequestNumber: 42,
            envBranch: "preview/pr-42",
            stackName: "preview-pr-42",
            primaryDomain: "preview-42.example.test"
          }
        },
        updatedAt: new Date(now - 45 * 60 * 1000),
        createdAt: new Date(now - 45 * 60 * 1000),
        concludedAt: new Date(now - 44 * 60 * 1000)
      },
      {
        id: `depprevmatch_${now}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose",
        commitSha: "cccccccccccccccccccccccccccccccccccccccc",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "deploy",
            key: "pr-43",
            branch: "feature/matched",
            pullRequestNumber: 43,
            envBranch: "preview/pr-43",
            stackName: "preview-pr-43",
            primaryDomain: "preview-43.example.test"
          }
        },
        updatedAt: new Date(now - 20 * 60 * 1000),
        createdAt: new Date(now - 20 * 60 * 1000),
        concludedAt: new Date(now - 19 * 60 * 1000)
      }
    ]);

    await db.insert(tunnels).values({
      id: `tunnelprev${now}`.slice(0, 32),
      name: `Preview Tunnel ${now}`,
      teamId: "team_foundation",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(tunnelRoutes).values([
      {
        id: `routeprev42${now}`.slice(0, 32),
        tunnelId: `tunnelprev${now}`.slice(0, 32),
        hostname: "preview-42.example.test",
        service: "http://preview-pr-42:8080",
        status: "active",
        updatedAt: new Date()
      },
      {
        id: `routeprev43${now}`.slice(0, 32),
        tunnelId: `tunnelprev${now}`.slice(0, 32),
        hostname: "preview-43.example.test",
        service: "http://preview-pr-43:8080",
        status: "active",
        updatedAt: new Date()
      }
    ]);

    const report = await caller.composePreviewReconciliation({
      serviceId: serviceResult.service.id
    });

    expect(report.policy).toMatchObject({ staleAfterHours: 1 });
    expect(report.summary).toMatchObject({
      totalPreviews: 3,
      inSync: 1,
      drifted: 1,
      stale: 1,
      gcEligible: 1
    });
    expect(report.previews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pr-41",
          domainStatus: "missing",
          reconciliationStatus: "stale",
          isStale: true,
          gcEligible: true
        }),
        expect.objectContaining({
          key: "pr-42",
          domainStatus: "orphaned",
          reconciliationStatus: "drifted",
          isStale: false
        }),
        expect.objectContaining({
          key: "pr-43",
          domainStatus: "matched",
          reconciliationStatus: "in-sync",
          isStale: false
        })
      ])
    );
  });

  it("aggregates compose preview status from deployment history", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-previews",
      session: makeSession("viewer")
    });

    const projectResult = await createProject({
      name: `preview-history-${Date.now()}`,
      description: "Preview history fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create preview history fixture project.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `preview-history-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create preview history fixture environment.");
    }

    const serviceResult = await createService({
      name: `preview-history-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create preview history fixture service.");
    }

    const now = Date.now();
    await db.insert(deployments).values([
      {
        id: `depprev_${now}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose",
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "deploy",
            key: "pr-42",
            branch: "feature/login",
            pullRequestNumber: 42,
            envBranch: "preview/pr-42",
            stackName: "preview-pr-42",
            primaryDomain: "preview-42.example.test"
          }
        },
        updatedAt: new Date(now - 30_000),
        createdAt: new Date(now - 30_000),
        concludedAt: new Date(now - 20_000)
      },
      {
        id: `depprevclose_${now}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose",
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "destroy",
            key: "pr-42",
            branch: "feature/login",
            pullRequestNumber: 42,
            envBranch: "preview/pr-42",
            stackName: "preview-pr-42",
            primaryDomain: "preview-42.example.test"
          }
        },
        updatedAt: new Date(now - 10_000),
        createdAt: new Date(now - 10_000),
        concludedAt: new Date(now - 5_000)
      }
    ]);

    const previewState = await caller.composePreviews({ serviceId: serviceResult.service.id });
    expect(previewState.previews).toEqual([
      expect.objectContaining({
        key: "pr-42",
        latestAction: "destroy",
        branch: "feature/login",
        primaryDomain: "preview-42.example.test",
        isActive: false
      })
    ]);
  });

  it("keeps preview history visible when newer non-preview deployments exist", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-previews-window",
      session: makeSession("viewer")
    });

    const projectResult = await createProject({
      name: `preview-history-window-${Date.now()}`,
      description: "Preview history window fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create preview history window fixture project.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `preview-history-window-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create preview history window fixture environment.");
    }

    const serviceResult = await createService({
      name: `preview-history-window-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create preview history window fixture service.");
    }

    const now = Date.now();
    await db.insert(deployments).values({
      id: `depprevold_${now}`.slice(0, 32),
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName: serviceResult.service.name,
      sourceType: "compose",
      commitSha: "1234512345123451234512345123451234512345",
      imageTag: "ghcr.io/example/api:preview",
      status: "completed",
      conclusion: "succeeded",
      configSnapshot: {
        preview: {
          target: "pull-request",
          action: "deploy",
          key: "pr-88",
          branch: "feature/long-lived-preview",
          pullRequestNumber: 88,
          envBranch: "preview/pr-88",
          stackName: "preview-pr-88",
          primaryDomain: "preview-88.example.test"
        }
      },
      updatedAt: new Date(now - 200_000),
      createdAt: new Date(now - 200_000),
      concludedAt: new Date(now - 190_000)
    });

    await db.insert(deployments).values(
      Array.from({ length: 120 }, (_, index) => ({
        id: `depstd${now}${index}`.slice(0, 32),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: serviceResult.service.name,
        sourceType: "compose" as const,
        commitSha: `${index}`.padStart(40, "0"),
        imageTag: "ghcr.io/example/api:stable",
        status: "completed" as const,
        conclusion: "succeeded" as const,
        configSnapshot: {
          composeOperation: "up"
        },
        updatedAt: new Date(now - (120 - index) * 1_000),
        createdAt: new Date(now - (120 - index) * 1_000),
        concludedAt: new Date(now - (120 - index) * 1_000 + 500)
      }))
    );

    const previewState = await caller.composePreviews({ serviceId: serviceResult.service.id });

    expect(previewState.previews).toEqual([
      expect.objectContaining({
        key: "pr-88",
        latestAction: "deploy",
        branch: "feature/long-lived-preview",
        isActive: true
      })
    ]);
  });

  it("queues stale preview cleanup deployments through reconciliation", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-preview-gc",
      session: makeSession("owner")
    });

    const projectResult = await createProject({
      name: `preview-gc-${Date.now()}`,
      description: "Preview GC fixture",
      repoUrl: "https://github.com/example/preview-gc",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create preview GC fixture project.");
    }

    const suffix = Date.now();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_rt_${suffix}`.slice(0, 32);
    const installationId = `gitinst_rt_${suffix}`.slice(0, 32);
    const repoFullName = `example/preview-gc-${suffix}`;

    await db.insert(gitProviders).values({
      id: providerId,
      type: "github",
      name: `Router Preview GC ${suffix}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      webhookSecret: "router-preview-gc-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "9901",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName,
        installationId: "9901"
      })
    );

    await db
      .update(projects)
      .set({
        repoFullName,
        composePath: "docker-compose.yml",
        gitProviderId: providerId,
        gitInstallationId: installationId,
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectResult.project.id));

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `preview-gc-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create preview GC fixture environment.");
    }

    const serviceResult = await createService({
      name: `preview-gc-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      preview: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "preview-{pr}.example.test",
        staleAfterHours: 1
      },
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create preview GC fixture service.");
    }

    const now = Date.now();
    await db.insert(deployments).values({
      id: `depprevgc${now}`.slice(0, 32),
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName: serviceResult.service.name,
      sourceType: "compose",
      commitSha: "dddddddddddddddddddddddddddddddddddddddd",
      imageTag: "ghcr.io/example/api:preview",
      status: "completed",
      conclusion: "succeeded",
      configSnapshot: {
        preview: {
          target: "pull-request",
          action: "deploy",
          key: "pr-51",
          branch: "feature/cleanup-me",
          pullRequestNumber: 51,
          envBranch: "preview/pr-51",
          stackName: "preview-pr-51",
          primaryDomain: "preview-51.example.test"
        }
      },
      updatedAt: new Date(now - 3 * 60 * 60 * 1000),
      createdAt: new Date(now - 3 * 60 * 60 * 1000),
      concludedAt: new Date(now - 3 * 60 * 60 * 1000 + 15_000)
    });

    const result = await caller.reconcileComposePreviews({
      serviceId: serviceResult.service.id,
      limit: 5
    });

    expect(result.execution).toMatchObject({
      dryRun: false,
      gcCandidates: 1,
      gcQueued: 1
    });
    expect(result.execution.queuedDeployments).toHaveLength(1);

    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, serviceResult.service.name))
      .orderBy(deployments.createdAt);
    expect(rows).toHaveLength(2);
    expect(readComposePreviewMetadata(asRecord(rows[1].configSnapshot).preview)).toMatchObject({
      key: "pr-51",
      action: "destroy"
    });
    expect(asRecord(rows[1].configSnapshot)).toMatchObject({
      composeOperation: "down"
    });

    const reconciliationEvents = await db
      .select()
      .from(events)
      .where(eq(events.resourceId, serviceResult.service.id));
    expect(reconciliationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "preview.reconciliation.executed"
        })
      ])
    );
  });
});
