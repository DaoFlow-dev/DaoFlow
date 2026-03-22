import { beforeEach, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { createEnvironment, createProject } from "./db/services/projects";
import { createService } from "./db/services/services";
import { appRouter } from "./router";
import { createLocalGitRepository, type LocalGitRepositoryFixture } from "./test-git-repo";
import { resetSeededTestDatabase } from "./test-db";

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

beforeEach(async () => {
  await resetSeededTestDatabase();
});

async function createRepoBackedComposeService(input: {
  files: Record<string, string>;
  composeServiceName?: string;
}): Promise<{
  repository: LocalGitRepositoryFixture;
  serviceId: string;
}> {
  const repository = createLocalGitRepository({
    files: input.files
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const projectResult = await createProject({
    name: `compose-preflight-${suffix}`,
    repoUrl: repository.rootDir,
    composePath: "deploy/compose.yaml",
    defaultBranch: "main",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") {
    repository.cleanup();
    throw new Error("Failed to create compose preflight fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `compose-preflight-env-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") {
    repository.cleanup();
    throw new Error("Failed to create compose preflight fixture environment.");
  }

  const serviceResult = await createService({
    name: `compose-preflight-svc-${suffix}`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    composeServiceName: input.composeServiceName,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (serviceResult.status !== "ok") {
    repository.cleanup();
    throw new Error("Failed to create compose preflight fixture service.");
  }

  return {
    repository,
    serviceId: serviceResult.service.id
  };
}

describe("deployment plan compose workspace preflight", () => {
  it("marks the plan not ready when a required env_file is missing from the repository checkout", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-missing-env-file",
      session: makeSession("viewer")
    });
    const fixture = await createRepoBackedComposeService({
      files: {
        "deploy/compose.yaml": [
          "services:",
          "  api:",
          "    image: nginx:alpine",
          "    env_file:",
          "      - ./config/runtime.env"
        ].join("\n")
      }
    });

    try {
      const plan = await caller.deploymentPlan({
        service: fixture.serviceId
      });

      expect(plan.isReady).toBe(false);
      expect(plan.composeEnvPlan).toBeNull();
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "fail" &&
            check.detail.includes('Compose env_file "./config/runtime.env"') &&
            check.detail.includes("was not found")
        )
      ).toBe(true);
    } finally {
      fixture.repository.cleanup();
    }
  });

  it("marks the plan not ready when env_file escapes the repository workspace", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-env-file-traversal",
      session: makeSession("viewer")
    });
    const fixture = await createRepoBackedComposeService({
      files: {
        "deploy/compose.yaml": [
          "services:",
          "  api:",
          "    image: nginx:alpine",
          "    env_file:",
          "      - ../../../../etc/passwd"
        ].join("\n")
      }
    });

    try {
      const plan = await caller.deploymentPlan({
        service: fixture.serviceId
      });

      expect(plan.isReady).toBe(false);
      expect(plan.composeEnvPlan).toBeNull();
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "fail" &&
            check.detail.includes(
              'Compose env_file "../../../../etc/passwd" resolves outside of the deployment workspace.'
            )
        )
      ).toBe(true);
    } finally {
      fixture.repository.cleanup();
    }
  });

  it("surfaces build-context execution for git-backed compose services", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-build-context",
      session: makeSession("viewer")
    });
    const fixture = await createRepoBackedComposeService({
      files: {
        Dockerfile: "FROM node:22-alpine\n",
        "deploy/compose.yaml": [
          "services:",
          "  api:",
          "    build:",
          "      context: .",
          "      dockerfile: ../Dockerfile"
        ].join("\n")
      }
    });

    try {
      const plan = await caller.deploymentPlan({
        service: fixture.serviceId
      });

      expect(plan.isReady).toBe(true);
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "ok" &&
            check.detail.includes("Compose build plan detected 1 build service: api.")
        )
      ).toBe(true);
      expect(plan.steps).toEqual(
        expect.arrayContaining(["Build compose services from the checked-out compose contexts"])
      );
    } finally {
      fixture.repository.cleanup();
    }
  });

  it("keeps the pull step when a scoped build service may start image-backed dependencies", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-build-only-scope",
      session: makeSession("viewer")
    });
    const fixture = await createRepoBackedComposeService({
      composeServiceName: "api",
      files: {
        Dockerfile: "FROM node:22-alpine\n",
        "deploy/compose.yaml": [
          "services:",
          "  api:",
          "    build:",
          "      context: .",
          "      dockerfile: ../Dockerfile",
          "    depends_on:",
          "      - worker",
          "  worker:",
          "    image: nginx:alpine"
        ].join("\n")
      }
    });

    try {
      const plan = await caller.deploymentPlan({
        service: fixture.serviceId
      });

      expect(plan.isReady).toBe(true);
      expect(plan.steps).toContain(
        "Resolve image references from the compose spec and refresh compose service api"
      );
      expect(plan.steps).toContain(
        "Build compose service api from the checked-out compose contexts"
      );
    } finally {
      fixture.repository.cleanup();
    }
  });

  it("omits the build step when the scoped compose service only needs pulled images", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-pull-only-scope",
      session: makeSession("viewer")
    });
    const fixture = await createRepoBackedComposeService({
      composeServiceName: "worker",
      files: {
        Dockerfile: "FROM node:22-alpine\n",
        "deploy/compose.yaml": [
          "services:",
          "  api:",
          "    build:",
          "      context: .",
          "      dockerfile: ../Dockerfile",
          "  worker:",
          "    image: nginx:alpine"
        ].join("\n")
      }
    });

    try {
      const plan = await caller.deploymentPlan({
        service: fixture.serviceId
      });

      expect(plan.isReady).toBe(true);
      expect(plan.steps).toContain(
        "Resolve image references from the compose spec and refresh compose service worker"
      );
      expect(plan.steps).not.toContain(
        "Build compose service worker from the checked-out compose contexts"
      );
    } finally {
      fixture.repository.cleanup();
    }
  });
});
