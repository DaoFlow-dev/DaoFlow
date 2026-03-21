import { describe, expect, test } from "bun:test";
import { previewServiceDeploy } from "./service-deploy-preview";

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

describe("previewServiceDeploy", () => {
  test("emits the planning-lane dry-run envelope in JSON mode", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    const logs = await captureConsoleLog(async () => {
      await previewServiceDeploy(
        {
          deploymentPlan: {
            query: (input) => {
              receivedInput = input as Record<string, unknown>;
              return Promise.resolve({
                isReady: true,
                service: {
                  name: "api",
                  projectName: "Acme",
                  environmentName: "production",
                  sourceType: "compose"
                },
                target: {
                  serverName: "prod-west",
                  targetKind: "docker-swarm-manager",
                  imageTag: "ghcr.io/acme/api:1.2.3"
                },
                currentDeployment: null,
                preflightChecks: [{ status: "ok", detail: "Resolved target server." }],
                steps: ["Freeze runtime spec", "Dispatch execution"],
                executeCommand: "daoflow deploy --service svc_123 --yes"
              });
            }
          }
        },
        {
          serviceId: "svc_123",
          serverId: "srv_123",
          imageTag: "ghcr.io/acme/api:1.2.3",
          preview: {
            target: "pull-request",
            branch: "feature/login",
            pullRequestNumber: 42
          },
          json: true
        }
      );
    });

    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        plan: {
          isReady: true,
          service: {
            name: "api",
            projectName: "Acme",
            environmentName: "production",
            sourceType: "compose"
          },
          target: {
            serverName: "prod-west",
            targetKind: "docker-swarm-manager",
            imageTag: "ghcr.io/acme/api:1.2.3"
          },
          currentDeployment: null,
          preflightChecks: [{ status: "ok", detail: "Resolved target server." }],
          steps: ["Freeze runtime spec", "Dispatch execution"],
          executeCommand: "daoflow deploy --service svc_123 --yes"
        }
      }
    });
    expect(receivedInput).toMatchObject({
      service: "svc_123",
      server: "srv_123",
      image: "ghcr.io/acme/api:1.2.3",
      preview: {
        target: "pull-request",
        branch: "feature/login",
        pullRequestNumber: 42
      }
    });
  });

  test("prints target kind and rollout mode in human dry-run output", async () => {
    const logs = await captureConsoleLog(async () => {
      await previewServiceDeploy(
        {
          deploymentPlan: {
            query: () =>
              Promise.resolve({
                isReady: true,
                service: {
                  name: "api",
                  projectName: "Acme",
                  environmentName: "production",
                  sourceType: "compose"
                },
                target: {
                  serverName: "swarm-mgr-1",
                  targetKind: "docker-swarm-manager",
                  imageTag: "ghcr.io/acme/api:1.2.3"
                },
                currentDeployment: null,
                preflightChecks: [
                  {
                    status: "ok",
                    detail: "Target server resolved to swarm-mgr-1 (10.0.0.25)."
                  }
                ],
                steps: [
                  "Freeze the compose inputs and resolved runtime spec",
                  "Run docker stack deploy for production on swarm-mgr-1"
                ],
                executeCommand: "daoflow deploy --service svc_123 --yes"
              })
          }
        },
        { serviceId: "svc_123" }
      );
    });

    expect(
      logs.some((line) => line.includes("Kind:") && line.includes("docker-swarm-manager"))
    ).toBe(true);
    expect(
      logs.some((line) => line.includes("Mode:") && line.includes("Docker Swarm stack workflow"))
    ).toBe(true);
  });
});
