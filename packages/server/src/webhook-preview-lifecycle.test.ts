import { createHmac, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { readComposePreviewMetadata } from "./compose-preview";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { approveApprovalRequest } from "./db/services/approvals";
import { processNextApprovalActionDispatch } from "./db/services/approval-dispatch-service";
import { triggerDeploy } from "./db/services/trigger-deploy";
import { createEnvironment, createProject } from "./db/services/projects";
import { asRecord } from "./db/services/json-helpers";
import { createService } from "./db/services/services";
import { approvalRequests, events } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { previewEnvironments } from "./db/schema/preview-environments";
import { projects } from "./db/schema/projects";
import { webhookDeliveries } from "./db/schema/webhook-deliveries";
import { resetTestDatabaseWithControlPlane } from "./test-db";

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
        new Response(JSON.stringify({ token: "ghs_preview_validation" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/repos/${input.repoFullName}`)) {
      return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    }

    if (url.includes(`/repos/${input.repoFullName}/branches/`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }

    if (
      url.includes(
        `/repos/${input.repoFullName}/contents/${encodedComposePath}?ref=${
          input.branch ? encodeURIComponent(branch) : ""
        }`
      )
    ) {
      return Promise.resolve(new Response(JSON.stringify({ path: composePath }), { status: 200 }));
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

function mockGitLabSourceFetch(input: {
  repoFullName: string;
  branch?: string;
  composePath?: string;
  projectId: number;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedRepoFullName = encodeURIComponent(input.repoFullName);
  const encodedProjectId = encodeURIComponent(String(input.projectId));
  const encodedBranch = encodeURIComponent(branch);
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/projects/${encodedRepoFullName}`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: input.projectId }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/projects/${encodedProjectId}/repository/branches/${encodedBranch}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }

    if (
      url.includes(
        `/projects/${encodedProjectId}/repository/files/${encodedComposePath}?ref=${encodedBranch}`
      )
    ) {
      return Promise.resolve(
        new Response(JSON.stringify({ file_path: composePath }), { status: 200 })
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

async function createPreviewFixture(input: {
  providerType: "github" | "gitlab";
  previewMode?: "pull-request" | "any" | "branch";
  previewPolicy?: "disabled" | "manual-approval";
}) {
  const suffix = Date.now();
  const repoFullName = `example/preview-webhook-${input.providerType}-${suffix}`;
  const projectResult = await createProject({
    name: `Preview ${input.providerType} ${suffix}`,
    repoUrl:
      input.providerType === "github"
        ? `https://github.com/${repoFullName}`
        : `https://gitlab.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create preview webhook project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create preview webhook environment fixture.");
  }

  const serviceResult = await createService({
    name: `${input.providerType}-preview-service`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    preview: {
      enabled: true,
      mode: input.previewMode ?? "pull-request",
      domainTemplate: "preview-{pr}.example.test"
    },
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create preview webhook service fixture.");
  }

  const providerId = `gitprov_${input.providerType}_${suffix}`.slice(0, 32);
  const installationId = `gitinst_${input.providerType}_${suffix}`.slice(0, 32);
  const webhookSecret = `${input.providerType}-preview-secret`;

  if (input.providerType === "github") {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: `Preview GitHub ${suffix}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      webhookSecret,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "9801",
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
        installationId: "9801"
      })
    );
  } else {
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `Preview GitLab ${suffix}`,
      webhookSecret,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "9802",
      accountName: "example",
      accountType: "group",
      repositorySelection: "all",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-preview-app" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        projectId: 9802
      })
    );
  }

  await db
    .update(projects)
    .set({
      repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: true,
      autoDeployBranch: "main",
      defaultBranch: "main",
      previewPolicy: input.previewPolicy ?? "manual-approval",
      previewPolicyRevision: 1,
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  return {
    repoFullName,
    webhookSecret,
    projectId: projectResult.project.id,
    serviceId: serviceResult.service.id,
    serviceName: serviceResult.service.name
  };
}

describe("preview lifecycle webhooks", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires approval for GitHub pull request previews before queueing deployment inputs", async () => {
    const fixture = await createPreviewFixture({ providerType: "github" });
    await expect(
      triggerDeploy({
        serviceId: fixture.serviceId,
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        preview: {
          target: "pull-request",
          branch: "feature/login",
          pullRequestNumber: 42,
          action: "deploy"
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner",
        trigger: "user"
      })
    ).resolves.toMatchObject({ status: "preview_approval_required" });
    const payload = JSON.stringify({
      action: "opened",
      number: 42,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/login",
          sha: "abcdef1234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-open-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      ok: boolean;
      action: string;
      previewKey: string;
      deployments: number;
      approvalRequiredTargets: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      action: "deploy",
      previewKey: "pr-42",
      deployments: 0,
      approvalRequiredTargets: 1
    });

    const [approval] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`));
    expect(approval?.status).toBe("pending");

    expect(
      await db.select().from(deployments).where(eq(deployments.serviceName, fixture.serviceName))
    ).toHaveLength(0);

    if (!approval) {
      throw new Error("Expected a pending preview approval request.");
    }
    const approvalResults = await Promise.all([
      approveApprovalRequest(
        approval.id,
        "team_foundation",
        "user_foundation_owner",
        "owner@daoflow.local",
        "owner"
      ),
      approveApprovalRequest(
        approval.id,
        "team_foundation",
        "user_foundation_operator",
        "operator@daoflow.local",
        "operator"
      )
    ]);
    expect(approvalResults.map((result) => result.status).sort()).toEqual(["invalid-state", "ok"]);
    await expect(processNextApprovalActionDispatch()).resolves.toMatchObject({
      status: "dispatched"
    });

    const previewDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(previewDeployments).toHaveLength(1);
    const [deployment] = previewDeployments;
    if (!deployment) {
      throw new Error("Expected exactly one approved preview deployment.");
    }
    const preview = readComposePreviewMetadata(asRecord(deployment.configSnapshot).preview);

    expect(preview).toMatchObject({
      key: "pr-42",
      action: "deploy",
      branch: "feature/login",
      envBranch: "preview/pr-42",
      primaryDomain: "preview-42.example.test"
    });
    expect(asRecord(deployment.configSnapshot)).toMatchObject({
      composeOperation: "up",
      branch: "feature/login",
      composeEnvBranch: "preview/pr-42"
    });

    const shadowRows = await db
      .select()
      .from(previewEnvironments)
      .where(eq(previewEnvironments.serviceId, fixture.serviceId));
    expect(shadowRows).toEqual([
      expect.objectContaining({
        previewKey: "pr-42",
        target: "pull-request",
        branch: "feature/login",
        status: "deploying",
        cleanupStatus: "not_requested",
        lastDeploymentId: deployment.id
      })
    ]);

    const deliveryRows = await db.select().from(webhookDeliveries);
    expect(deliveryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerType: "github",
          deliveryKey: "gh-preview-open-1",
          previewKey: "pr-42",
          previewAction: "deploy",
          status: "rejected"
        })
      ])
    );

    const serviceEvents = await db
      .select()
      .from(events)
      .where(eq(events.resourceId, fixture.serviceId));
    expect(serviceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "webhook.preview.approval_required.recorded"
        })
      ])
    );
  });

  it("rejects GitHub pull-request webhooks without an exact installation identity", async () => {
    const fixture = await createPreviewFixture({ providerType: "github" });
    const payload = JSON.stringify({
      action: "opened",
      number: 43,
      repository: { full_name: fixture.repoFullName },
      pull_request: {
        head: {
          ref: "feature/missing-installation",
          sha: "abcdef2234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-missing-installation",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });

    expect(response.status).toBe(400);
    expect(
      await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`))
    ).toHaveLength(0);
  });

  it("holds a same-repository GitHub pull request for exact-commit approval by default", async () => {
    const fixture = await createPreviewFixture({
      providerType: "github",
      previewPolicy: "manual-approval"
    });
    const payload = JSON.stringify({
      action: "opened",
      number: 43,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/manual-approval",
          sha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
          repo: { full_name: fixture.repoFullName }
        },
        author_association: "CONTRIBUTOR"
      },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-manual-approval",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      deployments: number;
      approvalRequiredTargets: number;
      blockedTargets: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      deployments: 0,
      approvalRequiredTargets: 1,
      blockedTargets: 0
    });
    expect(
      await db.select().from(deployments).where(eq(deployments.serviceName, fixture.serviceName))
    ).toHaveLength(0);

    const [approval] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`));
    expect(approval?.status).toBe("pending");
    const approvalSummary = asRecord(approval?.inputSummary);
    expect(approvalSummary.previewTrust).toMatchObject({
      providerType: "github",
      sourceRepository: fixture.repoFullName,
      commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
      policy: "manual-approval",
      policyRevision: 1,
      allowedSecretProfile: "project-environment",
      serviceId: fixture.serviceId,
      origin: {
        repositoryRelationship: "same-repository",
        authorAssociation: "CONTRIBUTOR",
        protectedSecretsAttached: true
      }
    });
    expect(asRecord(approvalSummary.previewTrust).expiresAt).toEqual(approvalSummary.expiresAt);
  });

  it("blocks a signed GitHub fork pull request without creating an approval or deployment", async () => {
    const fixture = await createPreviewFixture({ providerType: "github" });
    const payload = JSON.stringify({
      action: "opened",
      number: 44,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/from-fork",
          sha: "fedcbafedcbafedcbafedcbafedcbafedcbafedc",
          repo: { full_name: "contributor/forked-api" }
        },
        author_association: "FIRST_TIME_CONTRIBUTOR"
      },
      sender: { login: "contributor" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-fork-blocked",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      deployments: number;
      approvalRequiredTargets: number;
      blockedTargets: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      deployments: 0,
      approvalRequiredTargets: 0,
      blockedTargets: 1
    });
    expect(
      await db.select().from(deployments).where(eq(deployments.serviceName, fixture.serviceName))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`))
    ).toHaveLength(0);

    const serviceEvents = await db
      .select()
      .from(events)
      .where(eq(events.resourceId, fixture.serviceId));
    expect(serviceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "webhook.preview.blocked.recorded" })
      ])
    );
  });

  it("queues GitHub branch preview deploys for non-auto-deploy branches", async () => {
    const fixture = await createPreviewFixture({ providerType: "github", previewMode: "branch" });
    const payload = JSON.stringify({
      ref: "refs/heads/feature/shadow",
      after: "1234567890abcdef1234567890abcdef12345678",
      deleted: false,
      repository: { full_name: fixture.repoFullName },
      commits: [{ added: ["docker-compose.yml"], modified: [], removed: [] }],
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-branch-preview-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      ok: boolean;
      deployments: number;
      ignoredTargets: number;
      branch: string;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      deployments: 1,
      ignoredTargets: 0,
      branch: "feature/shadow"
    });

    const [shadow] = await db
      .select()
      .from(previewEnvironments)
      .where(eq(previewEnvironments.serviceId, fixture.serviceId));
    expect(shadow).toMatchObject({
      previewKey: "branch-feature-shadow",
      target: "branch",
      branch: "feature/shadow",
      envBranch: "preview/feature/shadow",
      status: "deploying"
    });
  });

  it("deduplicates repeated GitHub preview deliveries both by delivery id and by semantic preview state", async () => {
    const fixture = await createPreviewFixture({ providerType: "github" });
    const payload = JSON.stringify({
      action: "opened",
      number: 77,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/cache",
          sha: "bbbbbb1234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");
    const app = createApp();

    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-dup-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-dup-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const secondBody = (await second.json()) as { deduped?: boolean };

    const third = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-dup-2",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const thirdBody = (await third.json()) as { dedupedTargets?: number };

    expect(second.status).toBe(200);
    expect(secondBody.deduped).toBe(true);
    expect(third.status).toBe(200);
    expect(thirdBody.dedupedTargets).toBe(1);

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(queued).toHaveLength(0);
    expect(
      await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`))
    ).toHaveLength(1);

    const deliveryRows = await db.select().from(webhookDeliveries);
    expect(deliveryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deliveryKey: "gh-preview-dup-1",
          status: "rejected"
        }),
        expect.objectContaining({
          deliveryKey: "gh-preview-dup-2",
          status: "deduped"
        })
      ])
    );
  });

  it("queues GitHub pull request cleanup as a preview destroy deployment", async () => {
    const fixture = await createPreviewFixture({ providerType: "github" });
    const app = createApp();
    const openPayload = JSON.stringify({
      action: "opened",
      number: 19,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/cleanup",
          sha: "cccccc1234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      },
      sender: { login: "octocat" }
    });
    const openSignature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(openPayload).digest("hex");
    await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-close-open",
        "X-Hub-Signature-256": openSignature
      },
      body: openPayload
    });

    const closePayload = JSON.stringify({
      action: "closed",
      number: 19,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        merged: true,
        head: {
          ref: "feature/cleanup",
          sha: "cccccc1234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      },
      sender: { login: "octocat" }
    });
    const closeSignature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(closePayload).digest("hex");

    const response = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-close-1",
        "X-Hub-Signature-256": closeSignature
      },
      body: closePayload
    });
    const body = (await response.json()) as { action: string; deployments: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "destroy",
      deployments: 1
    });

    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName))
      .orderBy(deployments.createdAt);
    expect(rows).toHaveLength(1);
    const latestPreview = readComposePreviewMetadata(asRecord(rows[0].configSnapshot).preview);
    expect(latestPreview).toMatchObject({
      key: "pr-19",
      action: "destroy"
    });
    expect(asRecord(rows[0].configSnapshot)).toMatchObject({
      composeOperation: "down"
    });
  });

  it("queues GitLab merge request preview deploys and cleanup", async () => {
    const fixture = await createPreviewFixture({ providerType: "gitlab" });
    const app = createApp();
    const openPayload = JSON.stringify({
      object_kind: "merge_request",
      event_type: "merge_request",
      project: { path_with_namespace: fixture.repoFullName },
      user: { username: "gitlab-bot" },
      object_attributes: {
        iid: 51,
        action: "open",
        source_branch: "feature/gitlab-preview",
        source: { path_with_namespace: fixture.repoFullName },
        last_commit: {
          id: "dddddd1234567890abcdef1234567890abcdef12"
        }
      }
    });

    const openResponse = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": fixture.webhookSecret,
        "X-GitLab-Event": "Merge Request Hook",
        "X-GitLab-Event-UUID": "gl-preview-open-1"
      },
      body: openPayload
    });
    const openBody = (await openResponse.json()) as {
      deployments: number;
      action: string;
      approvalRequiredTargets: number;
    };

    expect(openResponse.status).toBe(200);
    expect(openBody).toMatchObject({
      deployments: 0,
      action: "deploy",
      approvalRequiredTargets: 1
    });

    const [approval] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.targetResource, `service/${fixture.serviceId}`));
    if (!approval) {
      throw new Error("Expected a pending GitLab preview approval request.");
    }
    await expect(
      approveApprovalRequest(
        approval.id,
        "team_foundation",
        "user_foundation_owner",
        "owner@daoflow.local",
        "owner"
      )
    ).resolves.toMatchObject({ status: "ok" });
    await expect(processNextApprovalActionDispatch()).resolves.toMatchObject({
      status: "dispatched"
    });

    const mergePayload = JSON.stringify({
      object_kind: "merge_request",
      event_type: "merge_request",
      project: { path_with_namespace: fixture.repoFullName },
      user: { username: "gitlab-bot" },
      object_attributes: {
        iid: 51,
        action: "merge",
        source_branch: "feature/gitlab-preview",
        source: { path_with_namespace: fixture.repoFullName },
        last_commit: {
          id: "dddddd1234567890abcdef1234567890abcdef12"
        }
      }
    });

    const mergeResponse = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": fixture.webhookSecret,
        "X-GitLab-Event": "Merge Request Hook",
        "X-GitLab-Event-UUID": "gl-preview-merge-1"
      },
      body: mergePayload
    });
    const mergeBody = (await mergeResponse.json()) as { deployments: number; action: string };

    expect(mergeResponse.status).toBe(200);
    expect(mergeBody).toMatchObject({
      deployments: 1,
      action: "destroy"
    });

    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName))
      .orderBy(deployments.createdAt);
    expect(rows).toHaveLength(2);
    expect(readComposePreviewMetadata(asRecord(rows[0].configSnapshot).preview)).toMatchObject({
      key: "pr-51",
      action: "deploy"
    });
    expect(readComposePreviewMetadata(asRecord(rows[1].configSnapshot).preview)).toMatchObject({
      key: "pr-51",
      action: "destroy"
    });
  });

  it("records ignored preview lifecycle deliveries when services do not allow pull-request previews", async () => {
    const fixture = await createPreviewFixture({
      providerType: "github",
      previewMode: "branch"
    });
    const payload = JSON.stringify({
      action: "opened",
      number: 12,
      repository: { full_name: fixture.repoFullName },
      installation: { id: 9801, account: { login: "example" } },
      pull_request: {
        head: {
          ref: "feature/ignored",
          sha: "eeeeee1234567890abcdef1234567890abcdef12",
          repo: { full_name: fixture.repoFullName }
        }
      },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", fixture.webhookSecret).update(payload).digest("hex");

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "gh-preview-ignored-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      deployments: number;
      ignoredTargets: number;
      failedTargets: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      deployments: 0,
      ignoredTargets: 1,
      failedTargets: 0
    });

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(queued).toHaveLength(0);

    const ignoredEventRows = await db
      .select()
      .from(events)
      .where(eq(events.resourceId, fixture.projectId));
    expect(ignoredEventRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "webhook.preview.ignored.recorded"
        })
      ])
    );
  });
});
