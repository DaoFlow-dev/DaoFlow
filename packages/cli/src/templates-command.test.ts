import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

interface TemplateListPayload {
  ok: boolean;
  data: {
    templates: Array<{
      slug: string;
    }>;
  };
}

interface TemplatePlanPayload {
  ok: boolean;
  data: {
    template: {
      slug: string;
    };
    projectName: string;
    inputs: Array<{
      key: string;
      value: string;
      isSecret: boolean;
    }>;
    plan: {
      target: {
        serverId: string;
      };
    };
  };
}

describe("templates command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-templates-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUrl) {
      process.env.DAOFLOW_URL = originalUrl;
    } else {
      delete process.env.DAOFLOW_URL;
    }

    if (originalToken) {
      process.env.DAOFLOW_TOKEN = originalToken;
    } else {
      delete process.env.DAOFLOW_TOKEN;
    }

    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("templates list returns the local starter catalog in JSON mode", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "templates", "list", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    const payload = JSON.parse(result.logs[0]) as TemplateListPayload;
    expect(payload.ok).toBe(true);
    expect(payload.data.templates.some((template) => template.slug === "postgres")).toBe(true);
    expect(payload.data.templates.some((template) => template.slug === "redis")).toBe(true);
    expect(payload.data.templates.some((template) => template.slug === "n8n")).toBe(true);
  });

  test("templates plan returns a normal compose plan envelope", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/composeDeploymentPlan");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                isReady: true,
                deploymentSource: "uploaded-compose",
                project: { id: null, name: "analytics-db", action: "create" },
                environment: { id: null, name: "production", action: "create" },
                service: {
                  id: null,
                  name: "analytics-db",
                  action: "create",
                  sourceType: "compose"
                },
                composeEnvPlan: {
                  branch: "main",
                  matchedBranchOverrideCount: 0,
                  composeEnv: {
                    precedence: ["compose file"],
                    counts: {
                      total: 0,
                      repoDefaults: 0,
                      environmentVariables: 0,
                      runtime: 0,
                      build: 0,
                      secrets: 0,
                      overriddenRepoDefaults: 0
                    },
                    warnings: [],
                    entries: []
                  },
                  interpolation: {
                    status: "ok",
                    summary: {
                      totalReferences: 0,
                      unresolved: 0,
                      requiredMissing: 0,
                      optionalMissing: 0
                    },
                    warnings: [],
                    unresolved: []
                  }
                },
                target: {
                  serverId: "srv_123",
                  serverName: "foundation",
                  serverHost: "203.0.113.10",
                  targetKind: "docker-engine",
                  composePath: "templates/postgres.yaml",
                  composeFiles: ["templates/postgres.yaml"],
                  composeProfiles: [],
                  contextPath: ".",
                  requiresContextUpload: false,
                  localBuildContexts: [],
                  contextBundle: null
                },
                preflightChecks: [{ status: "ok", detail: "ready" }],
                steps: ["Render the template", "Run docker compose up -d on foundation"],
                executeCommand: "daoflow deploy --compose templates/postgres.yaml --server srv_123"
              }
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "templates",
        "plan",
        "postgres",
        "--server",
        "srv_123",
        "--project-name",
        "analytics-db",
        "--set",
        "postgres_password=super-secret",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    const payload = JSON.parse(result.logs[0]) as TemplatePlanPayload;
    expect(payload.ok).toBe(true);
    expect(payload.data.template.slug).toBe("postgres");
    expect(payload.data.projectName).toBe("analytics-db");
    expect(
      payload.data.inputs.some(
        (input) =>
          input.key === "postgres_password" && input.value === "••••••••" && input.isSecret === true
      )
    ).toBe(true);
    expect(payload.data.plan.target.serverId).toBe("srv_123");
  });

  test("templates apply requires confirmation and forwards the idempotency key", async () => {
    let receivedIdempotencyKey: string | null = null;

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.endsWith("/api/v1/deploy/compose")) {
        throw new Error(`Unexpected URL ${url}`);
      }

      receivedIdempotencyKey = new Headers(init?.headers).get("x-idempotency-key");

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, deploymentId: "dep_tpl_123" }), {
          headers: { "content-type": "application/json" }
        })
      );
    }) as unknown as typeof fetch;

    const denied = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "templates",
        "apply",
        "redis",
        "--server",
        "srv_123",
        "--set",
        "redis_password=super-secret",
        "--json"
      ]);
    });

    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.logs[0])).toEqual({
      ok: false,
      error: "Instantiate template redis on srv_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });

    const approved = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "--idempotency-key",
        "tpl-apply-1",
        "templates",
        "apply",
        "redis",
        "--server",
        "srv_123",
        "--set",
        "redis_password=super-secret",
        "--yes",
        "--json"
      ]);
    });

    expect(approved.exitCode).toBeNull();
    if (receivedIdempotencyKey === null) {
      throw new Error("Expected the idempotency key to be forwarded.");
    }
    expect(String(receivedIdempotencyKey)).toBe("tpl-apply-1");
    expect(JSON.parse(approved.logs[0])).toEqual({
      ok: true,
      data: {
        template: {
          slug: "redis",
          name: "Redis"
        },
        projectName: "redis",
        serverId: "srv_123",
        deploymentId: "dep_tpl_123",
        inputs: [
          {
            key: "redis_password",
            label: "Redis password",
            kind: "secret",
            value: "••••••••",
            isSecret: true
          },
          {
            key: "redis_port",
            label: "Published port",
            kind: "port",
            value: "6379",
            isSecret: false
          }
        ]
      }
    });
  });
});
