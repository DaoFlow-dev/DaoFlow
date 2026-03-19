import { describe, expect, it } from "vitest";
import {
  buildComposeBuildPlan,
  rewriteComposeBuildAndSecretReferences
} from "./compose-build-plan";
import { resolveComposeExecutionScope } from "./compose-build-plan-execution";

describe("compose build plan", () => {
  it("rewrites local build contexts and secret files relative to the workspace root", () => {
    const doc = {
      services: {
        api: {
          image: "ghcr.io/example/api:stable",
          build: {
            context: ".",
            dockerfile: "../Dockerfile",
            args: {
              NODE_ENV: "production",
              API_TOKEN: "${API_TOKEN}"
            },
            secrets: [
              {
                source: "npm_token",
                target: "npm_token"
              }
            ]
          },
          volumes: ["./data:/var/lib/app"],
          configs: ["runtime_cfg"]
        }
      },
      secrets: {
        npm_token: {
          file: "./secrets/npm.token"
        }
      },
      configs: {
        runtime_cfg: {
          file: "./config/runtime.conf"
        }
      }
    } satisfies Record<string, unknown>;

    const warnings = rewriteComposeBuildAndSecretReferences({
      doc,
      workDir: "/workspace",
      composeFile: "deploy/compose.yaml"
    });
    const plan = buildComposeBuildPlan(doc, warnings);

    expect(warnings).toEqual([]);
    expect(plan).toMatchObject({
      stackName: null,
      strategy: "build-only",
      services: [
        {
          serviceName: "api",
          context: "deploy",
          dockerfile: "../Dockerfile",
          args: [
            { key: "API_TOKEN", source: "interpolated" },
            { key: "NODE_ENV", source: "literal" }
          ],
          secrets: [
            {
              sourceName: "npm_token",
              provider: "file",
              reference: "deploy/secrets/npm.token",
              target: "npm_token"
            }
          ]
        }
      ],
      graphServices: [
        {
          serviceName: "api",
          hasBuild: true,
          dependsOn: [],
          networks: [],
          namedVolumes: [],
          runtimeSecrets: [],
          configs: [
            {
              sourceName: "runtime_cfg",
              provider: "file",
              reference: "deploy/config/runtime.conf",
              target: null
            }
          ]
        }
      ],
      secrets: [
        {
          name: "npm_token",
          provider: "file",
          reference: "deploy/secrets/npm.token",
          external: false
        }
      ],
      configs: [
        {
          name: "runtime_cfg",
          provider: "file",
          reference: "deploy/config/runtime.conf",
          external: false
        }
      ]
    });
  });

  it("tracks pull-only compose stacks without fabricating build services", () => {
    const plan = buildComposeBuildPlan({
      services: {
        web: {
          image: "nginx:alpine"
        }
      }
    });

    expect(plan).toMatchObject({
      status: "materialized",
      version: 1,
      stackName: null,
      strategy: "pull-only",
      services: [],
      graphServices: [
        {
          serviceName: "web",
          hasBuild: false
        }
      ],
      networks: [],
      volumes: [],
      secrets: [],
      configs: [],
      warnings: []
    });
  });

  it("resolves scoped dependency closures and expected Docker health checks from the compose graph", () => {
    const plan = buildComposeBuildPlan({
      name: "demo-stack",
      services: {
        api: {
          build: ".",
          depends_on: {
            db: {
              condition: "service_healthy"
            },
            cache: {
              condition: "service_started"
            }
          },
          healthcheck: {
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
          },
          networks: ["frontend", "backend"],
          volumes: ["data:/data"],
          configs: ["runtime_config"],
          secrets: ["api_token"]
        },
        db: {
          image: "postgres:16",
          healthcheck: {
            test: ["CMD-SHELL", "pg_isready"]
          }
        },
        cache: {
          image: "redis:7"
        }
      },
      volumes: {
        data: {}
      },
      secrets: {
        api_token: {
          environment: "API_TOKEN"
        }
      },
      configs: {
        runtime_config: {
          file: "./runtime.conf"
        }
      },
      networks: {
        frontend: {},
        backend: {
          external: true
        }
      }
    });

    expect(plan).toMatchObject({
      stackName: "demo-stack",
      networks: [
        { name: "backend", external: true },
        { name: "frontend", external: false }
      ],
      volumes: [{ name: "data", external: false }],
      secrets: [{ name: "api_token", provider: "environment", reference: "API_TOKEN" }],
      configs: [{ name: "runtime_config", provider: "file", reference: "./runtime.conf" }]
    });
    expect(resolveComposeExecutionScope(plan, "api")).toEqual({
      requestedServiceName: "api",
      expectedServiceNames: ["api", "cache", "db"],
      buildServiceNames: ["api"],
      buildHealthcheckServiceNames: ["api", "db"],
      needsPull: true
    });
  });
});
