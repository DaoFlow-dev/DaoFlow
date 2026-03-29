import { expect, test } from "@playwright/test";
import { e2eOwnerUser } from "../packages/server/src/testing/e2e-auth-users";
import { createCliHomeDir, getCliConfigMode, runCliJson, removeCliHomeDir } from "./cli-helpers";
import { PLAYWRIGHT_BASE_URL } from "./runtime";

const SEEDED_READY_SERVER_ID = "srv_foundation_1";

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

type ProjectCreateResponse = {
  ok: boolean;
  data: {
    project: {
      id: string;
      name: string;
      repoFullName: string | null;
      repoUrl: string | null;
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
    };
    nextSteps: {
      plan: {
        command: string;
        description: string;
      };
      deploy: {
        command: string;
        description: string;
      };
    };
  };
};

type PlanResponse = {
  ok: boolean;
  data: {
    isReady: boolean;
    service: {
      id: string;
      projectId: string;
      environmentId: string;
      name: string;
      sourceType: string;
    };
    target: {
      serverId: string;
      serverName: string;
      serverHost: string;
      targetKind: string;
      imageTag: string | null;
    };
    preflightChecks: Array<{
      status: string;
      detail: string;
    }>;
    steps: string[];
    executeCommand: string;
  };
};

test.describe("CLI bootstrap and planning flows", () => {
  test("compiled CLI can bootstrap a project and generate a live service plan", async () => {
    test.slow();

    const homeDir = createCliHomeDir();
    const suffix = Date.now().toString(36);
    const projectName = `cli-bootstrap-${suffix}`;
    const environmentName = `production-${suffix}`;
    const serviceName = `web-${suffix}`;
    const repoUrl = `https://github.com/acme/${projectName}`;

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

      const project = runCliJson<ProjectCreateResponse>({
        homeDir,
        args: [
          "projects",
          "create",
          "--name",
          projectName,
          "--repo-url",
          repoUrl,
          "--yes",
          "--json"
        ]
      });

      expect(project.ok).toBe(true);
      expect(project.data.project.id).toBeTruthy();
      expect(project.data.project.name).toBe(projectName);
      expect(project.data.project.repoUrl).toBe(repoUrl);
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
          SEEDED_READY_SERVER_ID,
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
          SEEDED_READY_SERVER_ID,
          "--port",
          "80",
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
      expect(service.data.nextSteps.plan.command).toBe(
        `daoflow plan --service ${service.data.service.id}`
      );
      expect(service.data.nextSteps.deploy.command).toBe(
        `daoflow deploy --service ${service.data.service.id} --yes`
      );

      const plan = runCliJson<PlanResponse>({
        homeDir,
        args: ["plan", "--service", service.data.service.id, "--json"]
      });

      expect(plan.ok).toBe(true);
      expect(plan.data.isReady).toBe(true);
      expect(plan.data.service.id).toBe(service.data.service.id);
      expect(plan.data.service.projectId).toBe(project.data.project.id);
      expect(plan.data.service.environmentId).toBe(environment.data.environment.id);
      expect(plan.data.service.name).toBe(serviceName);
      expect(plan.data.service.sourceType).toBe("image");
      expect(plan.data.target.serverId).toBe(SEEDED_READY_SERVER_ID);
      expect(plan.data.preflightChecks.length).toBeGreaterThan(0);
      expect(plan.data.preflightChecks.every((check) => check.status !== "fail")).toBe(true);
      expect(plan.data.steps.length).toBeGreaterThan(0);
      expect(plan.data.executeCommand).toContain(
        `daoflow deploy --service ${service.data.service.id}`
      );
      expect(plan.data.executeCommand).toContain("--yes");
    } finally {
      removeCliHomeDir(homeDir);
    }
  });
});
