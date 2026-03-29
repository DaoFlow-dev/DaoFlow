import { expect, test } from "@playwright/test";
import { e2eOwnerUser } from "../packages/server/src/testing/e2e-auth-users";
import { createCliHomeDir, getCliConfigMode, runCliJson, removeCliHomeDir } from "./cli-helpers";
import { PLAYWRIGHT_BASE_URL } from "./runtime";

type LoginResponse = {
  ok: boolean;
  data: {
    apiUrl: string;
    context: string;
    authMode: string;
    validated: boolean;
    authMethod: string;
    principalEmail: string | null;
    role: string | null;
  };
};

type StatusResponse = {
  ok: boolean;
  data: {
    servers: {
      checks: Array<{
        serverId: string;
        serverName: string;
        serverHost: string;
        readinessStatus: string;
        sshReachable: boolean;
        dockerReachable: boolean;
        composeReachable: boolean;
      }>;
    } | null;
  };
};

type ServerAddResponse = {
  ok: boolean;
  data: {
    server: {
      id: string;
      host: string;
      status: string;
    };
    readiness: {
      readinessStatus: string;
      sshReachable: boolean;
      dockerReachable: boolean;
      composeReachable: boolean;
    };
  };
};

type ProjectCreateResponse = {
  ok: boolean;
  data: {
    project: {
      id: string;
      name: string;
      status: string;
    };
  };
};

type EnvironmentCreateResponse = {
  ok: boolean;
  data: {
    environment: {
      id: string;
      projectId: string;
      name: string;
      status: string;
    };
  };
};

type ServiceCreateResponse = {
  ok: boolean;
  data: {
    service: {
      id: string;
      projectId: string;
      environmentId: string;
      name: string;
      sourceType: string;
      status: string;
      targetServerId: string | null;
    };
  };
};

type DeployResponse = {
  ok: boolean;
  data: {
    id: string;
    serviceName: string;
  };
};

type ServicesListResponse = {
  ok: boolean;
  data: {
    projectId: string | null;
    services: Array<{
      id: string;
      name: string;
      runtimeSummary: {
        status: string;
        statusLabel: string;
        statusTone: string;
        summary: string;
      };
      latestDeployment: {
        id: string;
        status: string;
        statusLabel: string;
        statusTone: string;
      } | null;
    }>;
  };
};

type LogsResponse = {
  ok: boolean;
  data: {
    deploymentId: string | null;
    summary: {
      totalLines: number;
      stderrLines: number;
      deploymentCount: number;
    };
    lines: Array<{
      deploymentId: string;
      serviceName: string;
      message: string;
      stream: "stdout" | "stderr";
    }>;
  };
};

function isLocalHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveLocalServerId(homeDir: string, suffix: string): string {
  const status = runCliJson<StatusResponse>({
    homeDir,
    args: ["status", "--json"]
  });

  const existing = status.data.servers?.checks.find(
    (server) => isLocalHost(server.serverHost) && server.readinessStatus === "ready"
  );
  if (existing) {
    return existing.serverId;
  }

  const registered = runCliJson<ServerAddResponse>({
    homeDir,
    args: [
      "server",
      "add",
      "--name",
      `cli-worker-local-${suffix}`,
      "--host",
      "localhost",
      "--region",
      "local",
      "--yes",
      "--json"
    ]
  });

  expect(registered.ok).toBe(true);
  expect(registered.data.server.id).toBeTruthy();
  expect(registered.data.server.host).toBe("localhost");
  expect(registered.data.readiness.readinessStatus).toBe("ready");
  expect(registered.data.readiness.sshReachable).toBe(true);
  expect(registered.data.readiness.dockerReachable).toBe(true);
  expect(registered.data.readiness.composeReachable).toBe(true);

  return registered.data.server.id;
}

test.describe("CLI deploy execution flows", () => {
  test("compiled CLI can deploy a real service and inspect its outcome", async () => {
    test.slow();

    const homeDir = createCliHomeDir();
    const suffix = Date.now().toString(36);
    const projectName = `cli-deploy-${suffix}`;
    const environmentName = `worker-${suffix}`;
    const serviceName = `web-${suffix}`;

    try {
      const login = runCliJson<LoginResponse>({
        homeDir,
        args: [
          "login",
          "--url",
          PLAYWRIGHT_BASE_URL,
          "--email",
          e2eOwnerUser.email,
          "--password",
          e2eOwnerUser.password,
          "--json"
        ]
      });

      expect(login.ok).toBe(true);
      expect(login.data.apiUrl).toBe(PLAYWRIGHT_BASE_URL);
      expect(login.data.context).toBe("default");
      expect(login.data.authMode).toBe("email-password");
      expect(login.data.validated).toBe(true);
      expect(login.data.authMethod).toBe("session");
      expect(login.data.principalEmail).toBe(e2eOwnerUser.email);
      expect(login.data.role).toBe("owner");
      expect(getCliConfigMode(homeDir)).toBe(0o600);

      const serverId = resolveLocalServerId(homeDir, suffix);

      const project = runCliJson<ProjectCreateResponse>({
        homeDir,
        args: ["projects", "create", "--name", projectName, "--yes", "--json"]
      });

      expect(project.ok).toBe(true);
      expect(project.data.project.id).toBeTruthy();
      expect(project.data.project.name).toBe(projectName);
      expect(project.data.project.status).toBe("active");

      const environment = runCliJson<EnvironmentCreateResponse>({
        homeDir,
        args: [
          "projects",
          "env",
          "create",
          "--project",
          project.data.project.id,
          "--name",
          environmentName,
          "--server",
          serverId,
          "--yes",
          "--json"
        ]
      });

      expect(environment.ok).toBe(true);
      expect(environment.data.environment.id).toBeTruthy();
      expect(environment.data.environment.projectId).toBe(project.data.project.id);
      expect(environment.data.environment.name).toBe(environmentName);

      const service = runCliJson<ServiceCreateResponse>({
        homeDir,
        args: [
          "services",
          "create",
          "--project",
          project.data.project.id,
          "--environment",
          environment.data.environment.id,
          "--name",
          serviceName,
          "--source-type",
          "image",
          "--image",
          "nginx:alpine",
          "--server",
          serverId,
          "--port",
          "8080",
          "--healthcheck-path",
          "/",
          "--yes",
          "--json"
        ]
      });

      expect(service.ok).toBe(true);
      expect(service.data.service.id).toBeTruthy();
      expect(service.data.service.projectId).toBe(project.data.project.id);
      expect(service.data.service.environmentId).toBe(environment.data.environment.id);
      expect(service.data.service.name).toBe(serviceName);
      expect(service.data.service.sourceType).toBe("image");
      expect(service.data.service.targetServerId).toBe(serverId);

      const deployment = runCliJson<DeployResponse>({
        homeDir,
        args: ["deploy", "--service", service.data.service.id, "--yes", "--json"]
      });

      expect(deployment.ok).toBe(true);
      expect(deployment.data.id).toBeTruthy();
      expect(deployment.data.serviceName).toBe(serviceName);

      await expect
        .poll(
          () => {
            const services = runCliJson<ServicesListResponse>({
              homeDir,
              args: ["services", "list", "--project", project.data.project.id, "--json"]
            });
            const deployed = services.data.services.find(
              (entry) => entry.id === service.data.service.id
            );

            return {
              runtimeTone: deployed?.runtimeSummary.statusTone ?? null,
              latestDeploymentId: deployed?.latestDeployment?.id ?? null,
              latestDeploymentTone: deployed?.latestDeployment?.statusTone ?? null
            };
          },
          { timeout: 90_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toEqual({
          runtimeTone: "healthy",
          latestDeploymentId: deployment.data.id,
          latestDeploymentTone: "healthy"
        });

      await expect
        .poll(
          () =>
            runCliJson<LogsResponse>({
              homeDir,
              args: ["logs", "--deployment", deployment.data.id, "--lines", "200", "--json"]
            }).data.summary.totalLines,
          { timeout: 90_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toBeGreaterThan(0);

      const logs = runCliJson<LogsResponse>({
        homeDir,
        args: ["logs", "--deployment", deployment.data.id, "--lines", "200", "--json"]
      });

      expect(logs.ok).toBe(true);
      expect(logs.data.deploymentId).toBe(deployment.data.id);
      expect(logs.data.summary.totalLines).toBeGreaterThan(0);
      expect(logs.data.summary.deploymentCount).toBeGreaterThan(0);
      expect(logs.data.lines.some((line) => line.deploymentId === deployment.data.id)).toBe(true);
      expect(logs.data.lines.some((line) => line.serviceName === serviceName)).toBe(true);
      expect(logs.data.lines.some((line) => line.message.length > 0)).toBe(true);
    } finally {
      removeCliHomeDir(homeDir);
    }
  });
});
