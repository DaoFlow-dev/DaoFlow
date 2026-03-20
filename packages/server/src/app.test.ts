import { createHmac, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";
import { createAgentPrincipal, generateAgentToken } from "./db/services/agents";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { users } from "./db/schema/users";
import { encrypt } from "./db/crypto";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { createEnvironment, createProject } from "./db/services/projects";
import { createService } from "./db/services/services";
import { resetTestDatabase } from "./test-db";
import {
  ensureInitialOwnerFromEnv,
  resetInitialOwnerBootstrapState
} from "./bootstrap-initial-owner";

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
        new Response(JSON.stringify({ token: "ghs_webhook_validation" }), {
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

describe("createApp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      pollToken: string;
    };
    const pendingStatusResponse = await app.request(
      `/api/v1/cli-auth/status?requestId=${encodeURIComponent(startBody.requestId)}&userCode=${encodeURIComponent(startBody.userCode)}&pollToken=${encodeURIComponent(startBody.pollToken)}`
    );
    const pendingStatusBody = (await pendingStatusResponse.json()) as {
      ok: boolean;
      status: string;
      exchangeCode: string | null;
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
    const approvedStatusResponse = await app.request(
      `/api/v1/cli-auth/status?requestId=${encodeURIComponent(startBody.requestId)}&userCode=${encodeURIComponent(startBody.userCode)}&pollToken=${encodeURIComponent(startBody.pollToken)}`
    );
    const approvedStatusBody = (await approvedStatusResponse.json()) as {
      ok: boolean;
      status: string;
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
        exchangeCode: approvedStatusBody.exchangeCode
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
    expect(startBody.pollToken).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingStatusResponse.status).toBe(200);
    expect(pendingStatusBody).toMatchObject({
      ok: true,
      status: "pending",
      exchangeCode: null
    });
    expect(approveResponse.status).toBe(200);
    expect(approvedStatusResponse.status).toBe(200);
    expect(approvedStatusBody.ok).toBe(true);
    expect(approvedStatusBody.status).toBe("approved");
    expect(approvedStatusBody.exchangeCode).toBe(approveBody.exchangeCode);
    expect(exchangeResponse.status).toBe(200);
    expect(exchangeBody.token).toBeTruthy();
    expect(viewerResponse.status).toBe(200);
  });

  it("rejects CLI auth status polling without the signed poll token", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    resetInitialOwnerBootstrapState();

    const app = createApp();
    const startResponse = await app.request("/api/v1/cli-auth/start", {
      method: "POST"
    });
    const startBody = (await startResponse.json()) as {
      requestId: string;
      userCode: string;
      pollToken: string;
    };

    const missingTokenResponse = await app.request(
      `/api/v1/cli-auth/status?requestId=${encodeURIComponent(startBody.requestId)}&userCode=${encodeURIComponent(startBody.userCode)}`
    );
    const invalidTokenResponse = await app.request(
      `/api/v1/cli-auth/status?requestId=${encodeURIComponent(startBody.requestId)}&userCode=${encodeURIComponent(startBody.userCode)}&pollToken=invalid-token`
    );
    const missingTokenBody = (await missingTokenResponse.json()) as {
      ok: boolean;
      error: string;
      code: string;
    };
    const invalidTokenBody = (await invalidTokenResponse.json()) as {
      ok: boolean;
      error: string;
      code: string;
    };

    expect(startResponse.status).toBe(200);
    expect(missingTokenResponse.status).toBe(403);
    expect(missingTokenBody).toEqual({
      ok: false,
      error: "Invalid CLI auth poll token",
      code: "INVALID_POLL_TOKEN"
    });
    expect(invalidTokenResponse.status).toBe(403);
    expect(invalidTokenBody).toEqual({
      ok: false,
      error: "Invalid CLI auth poll token",
      code: "INVALID_POLL_TOKEN"
    });
  });

  it("keeps CLI browser approval and exchange idempotent", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    resetInitialOwnerBootstrapState();

    const app = createApp();
    const ownerEmail = `cli-idempotent+${Date.now()}@daoflow.local`;
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
      requestId: string;
      userCode: string;
      pollToken: string;
    };

    const approveHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: sessionCookie!
    };
    const approveBody = JSON.stringify({
      requestId: startBody.requestId,
      userCode: startBody.userCode
    });

    const firstApproveResponse = await app.request("/api/v1/cli-auth/approve", {
      method: "POST",
      headers: approveHeaders,
      body: approveBody
    });
    const secondApproveResponse = await app.request("/api/v1/cli-auth/approve", {
      method: "POST",
      headers: approveHeaders,
      body: approveBody
    });
    const firstApprovePayload = (await firstApproveResponse.json()) as {
      exchangeCode: string;
      approvedByEmail: string;
    };
    const secondApprovePayload = (await secondApproveResponse.json()) as {
      exchangeCode: string;
      approvedByEmail: string;
    };

    const exchangeBody = JSON.stringify({
      requestId: startBody.requestId,
      userCode: startBody.userCode,
      exchangeCode: firstApprovePayload.exchangeCode
    });

    const firstExchangeResponse = await app.request("/api/v1/cli-auth/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: exchangeBody
    });
    const secondExchangeResponse = await app.request("/api/v1/cli-auth/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: exchangeBody
    });
    const firstExchangePayload = (await firstExchangeResponse.json()) as {
      token: string;
      approvedByEmail: string;
    };
    const secondExchangePayload = (await secondExchangeResponse.json()) as {
      token: string;
      approvedByEmail: string;
    };

    expect(firstApproveResponse.status).toBe(200);
    expect(secondApproveResponse.status).toBe(200);
    expect(firstApprovePayload.exchangeCode).toBe(secondApprovePayload.exchangeCode);
    expect(firstApprovePayload.approvedByEmail).toBe(ownerEmail);
    expect(secondApprovePayload.approvedByEmail).toBe(ownerEmail);
    expect(firstExchangeResponse.status).toBe(200);
    expect(secondExchangeResponse.status).toBe(200);
    expect(firstExchangePayload.token).toBeTruthy();
    expect(secondExchangePayload.token).toBe(firstExchangePayload.token);
    expect(firstExchangePayload.approvedByEmail).toBe(ownerEmail);
    expect(secondExchangePayload.approvedByEmail).toBe(ownerEmail);
  });

  it("rejects CLI auth exchange requests with invalid exchange code lengths", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    resetInitialOwnerBootstrapState();

    const app = createApp();
    const ownerEmail = `cli-invalid+${Date.now()}@daoflow.local`;
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
      requestId: string;
      userCode: string;
      pollToken: string;
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

    expect(approveResponse.status).toBe(200);

    const exchangeResponse = await app.request("/api/v1/cli-auth/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requestId: startBody.requestId,
        userCode: startBody.userCode,
        exchangeCode: "dfcli_short"
      })
    });
    const exchangeBody = (await exchangeResponse.json()) as {
      ok: boolean;
      error: string;
      code: string;
    };

    expect(exchangeResponse.status).toBe(400);
    expect(exchangeBody).toEqual({
      ok: false,
      error: "Invalid CLI auth code",
      code: "INVALID_CODE"
    });
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

  it("rejects unauthenticated POST /api/v1/deploy/uploads/intake with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/deploy/uploads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        server: "test",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects malformed JSON on POST /api/v1/deploy/uploads/intake with 400", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();

    const app = createApp();
    const ownerEmail = `deploy-upload-json+${Date.now()}@daoflow.local`;
    const signUpResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "Deploy Upload JSON Owner",
        password: "secret1234"
      })
    });
    const sessionCookie =
      signUpResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      signUpResponse.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/)?.[0];

    const response = await app.request("/api/v1/deploy/uploads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!
      },
      body: "{"
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_JSON");
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
  }, 10_000);

  it("queues authenticated direct compose context uploads without metadata headers", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();

    const app = createApp();
    const ownerEmail = `deploy-upload-owner+${Date.now()}@daoflow.local`;
    const signUpResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "Deploy Upload Owner",
        password: "secret1234"
      })
    });
    const sessionCookie =
      signUpResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      signUpResponse.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/)?.[0];
    const largeCompose =
      "services:\n  web:\n    image: nginx:alpine\n" + "# comment\n".repeat(10_000);

    const intakeResponse = await app.request("/api/v1/deploy/uploads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!
      },
      body: JSON.stringify({
        server: "srv_foundation_1",
        compose: largeCompose
      })
    });
    const intakeBody = (await intakeResponse.json()) as {
      ok: boolean;
      uploadId: string;
    };

    expect(intakeResponse.status).toBe(200);
    expect(intakeBody.ok).toBe(true);
    expect(intakeBody.uploadId).toEqual(expect.any(String));

    const uploadResponse = await app.request(`/api/v1/deploy/uploads/${intakeBody.uploadId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/gzip",
        Cookie: sessionCookie!
      },
      body: new Uint8Array([1, 2, 3, 4])
    });
    const uploadBody = (await uploadResponse.json()) as {
      ok: boolean;
      deploymentId: string;
    };

    expect(uploadResponse.status).toBe(200);
    expect(uploadBody.ok).toBe(true);
    expect(uploadBody.deploymentId).toBe(intakeBody.uploadId);

    const [storedDeployment] = await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(eq(deployments.id, intakeBody.uploadId))
      .limit(1);

    expect(storedDeployment?.id).toBe(intakeBody.uploadId);
  });

  it("rejects direct compose context uploads when a different user reuses the upload id", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();

    const app = createApp();
    const ownerEmail = `deploy-upload-owner+${Date.now()}@daoflow.local`;
    const ownerSignUpResponse = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: ownerEmail,
        name: "Deploy Upload Owner",
        password: "secret1234"
      })
    });
    const ownerSessionCookie =
      ownerSignUpResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      ownerSignUpResponse.headers.get("set-cookie")?.match(/better-auth\.session_token=[^;]+/)?.[0];
    const viewerEmail = `deploy-upload-viewer+${Date.now()}@daoflow.local`;
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: viewerEmail,
        name: "Deploy Upload Viewer",
        password: "secret1234"
      })
    });
    await db.update(users).set({ role: "owner" }).where(eq(users.email, viewerEmail));
    const viewerSignInResponse = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        email: viewerEmail,
        password: "secret1234"
      })
    });
    const viewerSessionCookie =
      viewerSignInResponse.headers
        .getSetCookie?.()
        .find((cookie) => cookie.startsWith("better-auth.session_token=")) ??
      viewerSignInResponse.headers
        .get("set-cookie")
        ?.match(/better-auth\.session_token=[^;]+/)?.[0];

    const intakeResponse = await app.request("/api/v1/deploy/uploads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerSessionCookie!
      },
      body: JSON.stringify({
        server: "srv_foundation_1",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    const intakeBody = (await intakeResponse.json()) as {
      ok: boolean;
      uploadId: string;
    };

    const uploadResponse = await app.request(`/api/v1/deploy/uploads/${intakeBody.uploadId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/gzip",
        Cookie: viewerSessionCookie!
      },
      body: new Uint8Array([1, 2, 3, 4])
    });
    const uploadBody = (await uploadResponse.json()) as {
      ok: boolean;
      code: string;
    };

    expect(uploadResponse.status).toBe(404);
    expect(uploadBody.ok).toBe(false);
    expect(uploadBody.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("queues executable deployments for GitHub webhook auto-deploy targets", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const suffix = Date.now();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_gh_${suffix}`.slice(0, 32);
    const installationId = `gitinst_gh_${suffix}`.slice(0, 32);
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
      id: providerId,
      type: "github",
      name: `Webhook GitHub ${suffix}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      webhookSecret: "github-webhook-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "701",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName: "example/webhook-app",
        installationId: "701"
      })
    );

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-app",
        sourceType: "compose",
        gitProviderId: providerId,
        gitInstallationId: installationId,
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
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_gd_${suffix}`.slice(0, 32);
    const installationId = `gitinst_gd_${suffix}`.slice(0, 32);
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
      id: providerId,
      type: "github",
      name: `Webhook Drift ${suffix}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      webhookSecret: "github-webhook-drift-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "702",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName: "example/webhook-drift",
        installationId: "702"
      })
    );

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-drift",
        sourceType: "dockerfile",
        gitProviderId: providerId,
        gitInstallationId: installationId,
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
    const providerId = `gitprov_gl_${suffix}`.slice(0, 32);
    const installationId = `gitinst_gl_${suffix}`.slice(0, 32);
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
      id: providerId,
      type: "gitlab",
      name: `Webhook GitLab ${suffix}`,
      webhookSecret: "gitlab-webhook-secret",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "703",
      accountName: "example",
      accountType: "group",
      repositorySelection: "all",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-webhook-app" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName: "example/webhook-app",
        projectId: 703
      })
    );

    await db
      .update(projects)
      .set({
        repoFullName: "example/webhook-app",
        sourceType: "compose",
        gitProviderId: providerId,
        gitInstallationId: installationId,
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

  it("isolates webhook auto-deploy targets by provider type when repo paths overlap", async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();

    const suffix = Date.now();
    const sharedRepoFullName = "example/overlap-app";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

    const githubProject = await createProject({
      name: `Overlap GitHub ${suffix}`,
      repoUrl: `https://github.com/${sharedRepoFullName}`,
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(githubProject.status).toBe("ok");
    if (githubProject.status !== "ok") {
      throw new Error("Failed to create overlapping GitHub webhook project fixture.");
    }

    const githubEnvironment = await createEnvironment({
      projectId: githubProject.project.id,
      name: "production",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(githubEnvironment.status).toBe("ok");
    if (githubEnvironment.status !== "ok") {
      throw new Error("Failed to create overlapping GitHub webhook environment fixture.");
    }

    const githubService = await createService({
      name: "github-runtime",
      projectId: githubProject.project.id,
      environmentId: githubEnvironment.environment.id,
      sourceType: "compose",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(githubService.status).toBe("ok");
    if (githubService.status !== "ok") {
      throw new Error("Failed to create overlapping GitHub webhook service fixture.");
    }

    const gitlabProject = await createProject({
      name: `Overlap GitLab ${suffix}`,
      repoUrl: `https://gitlab.com/${sharedRepoFullName}`,
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(gitlabProject.status).toBe("ok");
    if (gitlabProject.status !== "ok") {
      throw new Error("Failed to create overlapping GitLab webhook project fixture.");
    }

    const gitlabEnvironment = await createEnvironment({
      projectId: gitlabProject.project.id,
      name: "production",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(gitlabEnvironment.status).toBe("ok");
    if (gitlabEnvironment.status !== "ok") {
      throw new Error("Failed to create overlapping GitLab webhook environment fixture.");
    }

    const gitlabService = await createService({
      name: "gitlab-runtime",
      projectId: gitlabProject.project.id,
      environmentId: gitlabEnvironment.environment.id,
      sourceType: "compose",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(gitlabService.status).toBe("ok");
    if (gitlabService.status !== "ok") {
      throw new Error("Failed to create overlapping GitLab webhook service fixture.");
    }

    const githubProviderId = `gitprov_ovgh_${suffix}`.slice(0, 32);
    const githubInstallationId = `gitinst_ovgh_${suffix}`.slice(0, 32);
    const gitlabProviderId = `gitprov_ovgl_${suffix}`.slice(0, 32);
    const gitlabInstallationId = `gitinst_ovgl_${suffix}`.slice(0, 32);

    await db.insert(gitProviders).values([
      {
        id: githubProviderId,
        type: "github",
        name: `Overlap GitHub ${suffix}`,
        appId: "123456",
        privateKeyEncrypted: encrypt(privateKeyPem),
        webhookSecret: "overlap-github-webhook-secret",
        status: "active",
        updatedAt: new Date()
      },
      {
        id: gitlabProviderId,
        type: "gitlab",
        name: `Overlap GitLab ${suffix}`,
        webhookSecret: "overlap-gitlab-webhook-secret",
        status: "active",
        updatedAt: new Date()
      }
    ]);

    await db.insert(gitInstallations).values([
      {
        id: githubInstallationId,
        providerId: githubProviderId,
        installationId: "704",
        accountName: "example",
        accountType: "organization",
        repositorySelection: "selected",
        status: "active",
        installedByUserId: "user_foundation_owner",
        updatedAt: new Date()
      },
      {
        id: gitlabInstallationId,
        providerId: gitlabProviderId,
        installationId: "705",
        accountName: "example",
        accountType: "group",
        repositorySelection: "all",
        permissions: encodeGitInstallationPermissions({ accessToken: "glpat-overlap-app" }),
        status: "active",
        installedByUserId: "user_foundation_owner",
        updatedAt: new Date()
      }
    ]);

    const githubFetch = mockGitHubSourceFetch({
      repoFullName: sharedRepoFullName,
      installationId: "704"
    });
    const gitlabFetch = mockGitLabSourceFetch({
      repoFullName: sharedRepoFullName,
      projectId: 705
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((request) => {
      const url = toRequestUrl(request);
      if (url.startsWith("https://api.github.com/")) {
        return githubFetch(request);
      }

      if (url.startsWith("https://gitlab.com/api/v4/")) {
        return gitlabFetch(request);
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    await db
      .update(projects)
      .set({
        repoFullName: sharedRepoFullName,
        sourceType: "compose",
        gitProviderId: githubProviderId,
        gitInstallationId: githubInstallationId,
        autoDeploy: true,
        autoDeployBranch: "main",
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, githubProject.project.id));

    await db
      .update(projects)
      .set({
        repoFullName: sharedRepoFullName,
        sourceType: "compose",
        gitProviderId: gitlabProviderId,
        gitInstallationId: gitlabInstallationId,
        autoDeploy: true,
        autoDeployBranch: "main",
        defaultBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, gitlabProject.project.id));

    const githubCommitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const githubPayload = JSON.stringify({
      ref: "refs/heads/main",
      after: githubCommitSha,
      repository: { full_name: sharedRepoFullName },
      sender: { login: "octocat" }
    });
    const githubSignature =
      "sha256=" +
      createHmac("sha256", "overlap-github-webhook-secret").update(githubPayload).digest("hex");

    const app = createApp();
    const githubResponse = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": githubSignature
      },
      body: githubPayload
    });
    const githubBody = (await githubResponse.json()) as { ok: boolean; deployments: number };

    expect(githubResponse.status).toBe(200);
    expect(githubBody.ok).toBe(true);
    expect(githubBody.deployments).toBe(1);

    const githubQueued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.commitSha, githubCommitSha));

    expect(githubQueued).toHaveLength(1);
    expect(githubQueued[0]).toEqual(
      expect.objectContaining({
        serviceName: "github-runtime",
        requestedByEmail: "octocat",
        requestedByRole: "agent"
      })
    );
  });

  it("rejects unauthenticated GET /api/v1/logs/stream with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/logs/stream/dep-test-123");
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects unauthenticated GET /api/v1/container-stats with 401", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/container-stats/svc-test-123");
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_REQUIRED");
  });
});
