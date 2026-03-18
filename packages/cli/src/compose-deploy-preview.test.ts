import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchComposeDeploymentPlan, previewComposeDeploy } from "./compose-deploy-preview";

async function captureConsoleLog(fn: () => Promise<void> | void): Promise<string[]> {
  const original = console.log;
  const messages: string[] = [];
  console.log = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await fn();
    return messages;
  } finally {
    console.log = original;
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("previewComposeDeploy", () => {
  test("fetchComposeDeploymentPlan prepares the compose planning request", async () => {
    const contextDir = mkdtempSync(join(tmpdir(), "daoflow-compose-fetch-"));
    tempDirs.push(contextDir);

    const composePath = join(contextDir, "compose.yaml");
    writeFileSync(
      composePath,
      [
        "name: preview-stack",
        "services:",
        "  web:",
        "    build:",
        "      context: .",
        "      dockerfile: Dockerfile"
      ].join("\n")
    );
    writeFileSync(join(contextDir, "Dockerfile"), "FROM alpine:3.20\n");
    writeFileSync(join(contextDir, ".env"), "HELLO=world\n");
    writeFileSync(join(contextDir, ".dockerignore"), "ignored.txt\n");
    writeFileSync(join(contextDir, ".daoflowignore"), "!.env\n");
    writeFileSync(join(contextDir, "app.txt"), "app\n");
    writeFileSync(join(contextDir, "ignored.txt"), "ignored\n");

    let receivedInput: Record<string, unknown> | undefined;
    const plan = await fetchComposeDeploymentPlan(
      {
        composeDeploymentPlan: {
          query: (input) => {
            receivedInput = input;
            return Promise.resolve({
              isReady: true,
              deploymentSource: "uploaded-context",
              project: {
                id: null,
                name: "preview-stack",
                action: "create"
              },
              environment: {
                id: null,
                name: "production",
                action: "create"
              },
              service: {
                id: null,
                name: "preview-stack",
                action: "create",
                sourceType: "compose"
              },
              target: {
                serverId: "srv_123",
                serverName: "prod-west",
                serverHost: "203.0.113.10",
                composePath,
                contextPath: contextDir,
                requiresContextUpload: true,
                localBuildContexts: [
                  {
                    serviceName: "web",
                    context: ".",
                    dockerfile: "Dockerfile"
                  }
                ],
                contextBundle: {
                  fileCount: 4,
                  sizeBytes: 1024,
                  includedOverrides: [".env"]
                }
              },
              preflightChecks: [{ status: "ok", detail: "Bundle preview ready." }],
              steps: ["Bundle", "Upload", "Dispatch"],
              executeCommand: "daoflow deploy --compose ./compose.yaml --server srv_123 --yes"
            });
          }
        }
      },
      {
        composePath,
        contextPath: contextDir,
        serverId: "srv_123"
      }
    );

    expect(plan.deploymentSource).toBe("uploaded-context");
    expect(receivedInput).toBeDefined();
    expect(receivedInput?.server).toBe("srv_123");
    expect(receivedInput?.requiresContextUpload).toBe(true);
    expect(receivedInput?.contextBundle).toMatchObject({
      includedOverrides: [".env"]
    });
    expect(receivedInput?.localBuildContexts).toEqual([
      {
        serviceName: "web",
        context: ".",
        dockerfile: "Dockerfile"
      }
    ]);
  });

  test("calls the planning lane and emits the dry-run envelope in JSON mode", async () => {
    const contextDir = mkdtempSync(join(tmpdir(), "daoflow-compose-preview-"));
    tempDirs.push(contextDir);

    const composePath = join(contextDir, "compose.yaml");
    writeFileSync(
      composePath,
      [
        "name: preview-stack",
        "services:",
        "  web:",
        "    build:",
        "      context: .",
        "      dockerfile: Dockerfile"
      ].join("\n")
    );
    writeFileSync(join(contextDir, "Dockerfile"), "FROM alpine:3.20\n");
    writeFileSync(join(contextDir, ".env"), "HELLO=world\n");
    writeFileSync(join(contextDir, ".dockerignore"), "ignored.txt\n");
    writeFileSync(join(contextDir, ".daoflowignore"), "!.env\n");
    writeFileSync(join(contextDir, "app.txt"), "app\n");
    writeFileSync(join(contextDir, "ignored.txt"), "ignored\n");

    let receivedInput: Record<string, unknown> | undefined;
    const logs = await captureConsoleLog(async () => {
      await previewComposeDeploy(
        {
          composeDeploymentPlan: {
            query: (input) => {
              receivedInput = input;
              return Promise.resolve({
                isReady: true,
                deploymentSource: "uploaded-context",
                project: {
                  id: null,
                  name: "preview-stack",
                  action: "create"
                },
                environment: {
                  id: null,
                  name: "production",
                  action: "create"
                },
                service: {
                  id: null,
                  name: "preview-stack",
                  action: "create",
                  sourceType: "compose"
                },
                target: {
                  serverId: "srv_123",
                  serverName: "prod-west",
                  serverHost: "203.0.113.10",
                  composePath,
                  contextPath: contextDir,
                  requiresContextUpload: true,
                  localBuildContexts: [
                    {
                      serviceName: "web",
                      context: ".",
                      dockerfile: "Dockerfile"
                    }
                  ],
                  contextBundle: {
                    fileCount: 4,
                    sizeBytes: 1024,
                    includedOverrides: [".env"]
                  }
                },
                preflightChecks: [{ status: "ok", detail: "Bundle preview ready." }],
                steps: ["Bundle", "Upload", "Dispatch"],
                executeCommand: "daoflow deploy --compose ./compose.yaml --server srv_123 --yes"
              });
            }
          }
        },
        {
          composePath,
          contextPath: contextDir,
          serverId: "srv_123",
          json: true
        }
      );
    });

    expect(receivedInput).toBeDefined();
    expect(receivedInput?.server).toBe("srv_123");
    expect(receivedInput?.requiresContextUpload).toBe(true);
    expect(receivedInput?.contextBundle).toMatchObject({
      includedOverrides: [".env"]
    });
    expect(receivedInput?.localBuildContexts).toEqual([
      {
        serviceName: "web",
        context: ".",
        dockerfile: "Dockerfile"
      }
    ]);

    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        plan: {
          isReady: true,
          deploymentSource: "uploaded-context",
          project: {
            id: null,
            name: "preview-stack",
            action: "create"
          },
          environment: {
            id: null,
            name: "production",
            action: "create"
          },
          service: {
            id: null,
            name: "preview-stack",
            action: "create",
            sourceType: "compose"
          },
          target: {
            serverId: "srv_123",
            serverName: "prod-west",
            serverHost: "203.0.113.10",
            composePath,
            contextPath: contextDir,
            requiresContextUpload: true,
            localBuildContexts: [
              {
                serviceName: "web",
                context: ".",
                dockerfile: "Dockerfile"
              }
            ],
            contextBundle: {
              fileCount: 4,
              sizeBytes: 1024,
              includedOverrides: [".env"]
            }
          },
          preflightChecks: [{ status: "ok", detail: "Bundle preview ready." }],
          steps: ["Bundle", "Upload", "Dispatch"],
          executeCommand: "daoflow deploy --compose ./compose.yaml --server srv_123 --yes"
        }
      }
    });
  });
});
