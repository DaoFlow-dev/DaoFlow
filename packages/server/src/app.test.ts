import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";
import { createAgentPrincipal, generateAgentToken } from "./db/services/agents";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { createEnvironment, createProject } from "./db/services/projects";
import { createService } from "./db/services/services";
import { resetTestDatabase } from "./test-db";
import {
  ensureInitialOwnerFromEnv,
  resetInitialOwnerBootstrapState
} from "./bootstrap-initial-owner";

describe("createApp", () => {
  it("serves the health endpoint with security and request metadata", async () => {
    const app = createApp();
    const response = await app.request("/health");
    const body = (await response.json()) as {
      requestId: string;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.requestId).toMatch(/^req-/);
    expect(response.headers.get("x-request-id")).toMatch(/^req-/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("mounts the tRPC HTTP endpoint", async () => {
    const app = createApp();
    const response = await app.request("/trpc/health");
    const body = (await response.json()) as {
      result: {
        data: {
          status: string;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.result.data.status).toBe("healthy");
  });

  it("mounts Better Auth with durable schema bootstrap", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();

    const app = createApp();
    const ownerEmail = `owner+${Date.now()}@daoflow.local`;
    const ownerResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "DaoFlow Operator",
        password: "secret1234"
      })
    });
    const ownerBody = (await ownerResponse.json()) as {
      user: {
        email: string;
        role: string;
      };
    };
    const viewerEmail = `viewer+${Date.now()}@daoflow.local`;
    const viewerResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: viewerEmail,
        name: "DaoFlow Viewer",
        password: "secret1234"
      })
    });
    const viewerBody = (await viewerResponse.json()) as {
      user: {
        email: string;
        role: string;
      };
    };

    expect(ownerResponse.status).toBe(200);
    expect(ownerBody.user.email).toBe(ownerEmail);
    expect(ownerBody.user.role).toBe("owner");
    expect(ownerResponse.headers.get("set-cookie")).toContain("better-auth.session_token");
    expect(viewerResponse.status).toBe(200);
    expect(viewerBody.user.email).toBe(viewerEmail);
    expect(viewerBody.user.role).toBe("viewer");
  });

  it("supports CLI browser login handoff", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    resetInitialOwnerBootstrapState();

    const app = createApp();
    const ownerEmail = `cli-owner+${Date.now()}@daoflow.local`;
    const signUpResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "CLI Owner",
        password: "secret1234"
      })
    });
    const sessionCookie =
      signUpResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      signUpResponse.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/)?.[0];

    expect(sessionCookie).toBeTruthy();

    const startResponse = await app.request("/api/v1/cli-auth/start", {
      method: "POST"
    });
    const startBody = (await startResponse.json()) as {
      ok: boolean;
      requestId: string;
      userCode: string;
    };

    const approveResponse = await app.request("/api/v1/cli-auth/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: sessionCookie!
      },
      body: JSON.stringify({
        requestId: startBody.requestId,
        userCode: startBody.userCode
      })
    });
    const approveBody = (await approveResponse.json()) as {
      ok: boolean;
      exchangeCode: string;
    };

    const exchangeResponse = await app.request("/api/v1/cli-auth/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requestId: startBody.requestId,
        userCode: startBody.userCode,
        exchangeCode: approveBody.exchangeCode
      })
    });
    const exchangeBody = (await exchangeResponse.json()) as {
      ok: boolean;
      token: string;
    };

    const viewerResponse = await app.request("/trpc/viewer", {
      headers: {
        Cookie: `better-auth.session_token=${exchangeBody.token}`
      }
    });

    expect(startResponse.status).toBe(200);
    expect(approveResponse.status).toBe(200);
    expect(exchangeResponse.status).toBe(200);
    expect(exchangeBody.token).toBeTruthy();
    expect(viewerResponse.status).toBe(200);
  });

  it("accepts bearer API tokens on tRPC routes", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const app = createApp();
    const created = await createAgentPrincipal({
      name: `api-token-agent-${Date.now()}`,
      description: "Token-backed viewer test",
      preset: "agent:read-only",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created.status).toBe("ok");

    const generated = await generateAgentToken({
      principalId: created.principal.id,
      tokenName: "viewer-token",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(generated.status).toBe("ok");

    const viewerResponse = await app.request("/trpc/viewer", {
      headers: {
        Authorization: `Bearer ${generated.tokenValue}`
      }
    });
    const body = (await viewerResponse.json()) as {
      result: {
        data: {
          principal: {
            type: string;
          };
          authz: {
            authMethod: string;
            capabilities: string[];
          };
          session: unknown;
        };
      };
    };

    expect(viewerResponse.status).toBe(200);
    expect(body.result.data.principal.type).toBe("agent");
    expect(body.result.data.authz.authMethod).toBe("api-token");
    expect(body.result.data.authz.capabilities).toContain("deploy:read");
    expect(body.result.data.session).toBeNull();
  });

  it("bootstraps an initial owner from environment credentials", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    resetInitialOwnerBootstrapState();

    const email = `bootstrap+${Date.now()}@daoflow.local`;
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = email;
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "bootstrap-secret-2026";

    try {
      await ensureInitialOwnerFromEnv();

      const app = createApp();
      const signInResponse = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          email,
          password: "bootstrap-secret-2026"
        })
      });

      expect(signInResponse.status).toBe(200);
      expect(signInResponse.headers.get("set-cookie")).toContain("better-auth.session_token");
    } finally {
      delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
      delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
      resetInitialOwnerBootstrapState();
    }
  });

  it("rejects unauthenticated GET /api/v1/images with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/images");
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects unauthenticated POST /api/v1/deploy/compose with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/deploy/compose", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ server: "test", compose: "version: '3'" })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("queues authenticated POST /api/v1/deploy/compose with a real deployment record", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();

    const app = createApp();
    const ownerEmail = `deploy-owner+${Date.now()}@daoflow.local`;
    const signUpResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "Deploy Owner",
        password: "secret1234"
      })
    });
    const sessionCookie =
      signUpResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      signUpResponse.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/)?.[0];

    const response = await app.request("/api/v1/deploy/compose", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!
      },
      body: JSON.stringify({
        server: "srv_foundation_1",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    const body = (await response.json()) as {
      ok: boolean;
      deploymentId: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deploymentId).toEqual(expect.any(String));
  });

  it("queues executable deployments for GitHub webhook auto-deploy targets", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const suffix = Date.now();
    const projectResult = await createProject({
      name: `Webhook GitHub ${suffix}`,
      repoUrl: "https://github.com/example/webhook-app",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create webhook project fixture.");
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
      throw new Error("Failed to create webhook environment fixture.");
    }

    const serviceResult = await createService({
      name: "control-plane",
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create webhook service fixture.");
    }

    await db.insert(gitProviders).values({
      id: "gitprov_webhook_gh",
      type: "github",
      name: `Webhook GitHub ${suffix}`,
      webhookSecret: "github-webhook-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-app",
        sourceType: "compose",
        gitProviderId: "gitprov_webhook_gh",
        autoDeploy: true,
        autoDeployBranch: "main",
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectResult.project.id));

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "abcdef1234567890abcdef1234567890abcdef12",
      repository: { full_name: "example/webhook-app" },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-webhook-secret").update(payload).digest("hex");

    const app = createApp();
    const response = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as { ok: boolean; deployments: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deployments).toBe(1);

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, "control-plane"));

    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetServerId: "srv_foundation_1",
          trigger: "webhook",
          commitSha: "abcdef1234567890abcdef1234567890abcdef12",
          requestedByUserId: null,
          requestedByEmail: "octocat",
          requestedByRole: "agent"
        })
      ])
    );
  });

  it("still queues webhook deployments when project sourceType drifts from service sourceType", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const suffix = Date.now();
    const projectResult = await createProject({
      name: `Webhook Drift ${suffix}`,
      repoUrl: "https://github.com/example/webhook-drift",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create webhook drift project fixture.");
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
      throw new Error("Failed to create webhook drift environment fixture.");
    }

    const serviceResult = await createService({
      name: "drifted-compose-service",
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create webhook drift service fixture.");
    }

    await db.insert(gitProviders).values({
      id: "gitprov_webhook_drift",
      type: "github",
      name: `Webhook Drift ${suffix}`,
      webhookSecret: "github-webhook-drift-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-drift",
        sourceType: "dockerfile",
        gitProviderId: "gitprov_webhook_drift",
        autoDeploy: true,
        autoDeployBranch: "main",
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectResult.project.id));

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "fedcba0987654321fedcba0987654321fedcba09",
      repository: { full_name: "example/webhook-drift" },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-webhook-drift-secret").update(payload).digest("hex");

    const app = createApp();
    const response = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as { ok: boolean; deployments: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deployments).toBe(1);

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, "drifted-compose-service"));

    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetServerId: "srv_foundation_1",
          trigger: "webhook",
          commitSha: "fedcba0987654321fedcba0987654321fedcba09"
        })
      ])
    );
  });

  it("queues executable deployments for GitLab webhook auto-deploy targets", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const suffix = Date.now();
    const projectResult = await createProject({
      name: `Webhook GitLab ${suffix}`,
      repoUrl: "https://gitlab.com/example/webhook-app",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create GitLab webhook project fixture.");
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
      throw new Error("Failed to create GitLab webhook environment fixture.");
    }

    const serviceResult = await createService({
      name: "agent-runtime",
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create GitLab webhook service fixture.");
    }

    await db.insert(gitProviders).values({
      id: "gitprov_webhook_gl",
      type: "gitlab",
      name: `Webhook GitLab ${suffix}`,
      webhookSecret: "gitlab-webhook-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-app",
        sourceType: "compose",
        gitProviderId: "gitprov_webhook_gl",
        autoDeploy: true,
        autoDeployBranch: "main",
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectResult.project.id));

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "1234567890abcdef1234567890abcdef12345678",
      project: { path_with_namespace: "example/webhook-app" },
      user_name: "gitlab-bot"
    });

    const app = createApp();
    const response = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": "gitlab-webhook-secret"
      },
      body: payload
    });
    const body = (await response.json()) as { ok: boolean; deployments: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deployments).toBe(1);

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, "agent-runtime"));

    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetServerId: "srv_foundation_1",
          trigger: "webhook",
          commitSha: "1234567890abcdef1234567890abcdef12345678",
          requestedByUserId: null,
          requestedByEmail: "gitlab-bot",
          requestedByRole: "agent"
        })
      ])
    );
  });

  it("rejects unauthenticated GET /api/v1/logs/stream with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/logs/stream/dep-test-123");
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });
});
