import { beforeEach, describe, expect, it } from "vitest";
import { asRecord } from "./db/services/json-helpers";
import { createEnvironment, createProject } from "./db/services/projects";
import { updateServiceRuntimeConfig } from "./db/services/service-runtime-config";
import { createService } from "./db/services/services";
import { triggerDeploy } from "./db/services/trigger-deploy";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { createLocalGitRepository } from "./test-git-repo";

describe("managed logging deployment snapshots", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("freezes the current logging state explicitly, including removal as null", async () => {
    const repository = createLocalGitRepository({
      files: {
        "compose.yaml": "services:\n  api:\n    image: nginx:alpine\n"
      }
    });

    try {
      const suffix = Date.now().toString();
      const projectResult = await createProject({
        name: `Logging Snapshot ${suffix}`,
        repoUrl: repository.rootDir,
        composePath: "compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(projectResult.status).toBe("ok");
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create logging snapshot project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `production-${suffix}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(environmentResult.status).toBe("ok");
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create logging snapshot environment.");
      }

      const serviceResult = await createService({
        name: `logging-snapshot-api-${suffix}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        composeServiceName: "api",
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(serviceResult.status).toBe("ok");
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create logging snapshot service.");
      }

      const beforeLogging = await triggerDeploy({
        serviceId: serviceResult.service.id,
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(beforeLogging.status).toBe("ok");
      if (beforeLogging.status !== "ok") {
        throw new Error("Expected initial logging snapshot deployment to queue.");
      }
      expect(asRecord(beforeLogging.deployment.configSnapshot)).toHaveProperty(
        "runtimeConfig",
        null
      );

      const enabled = await updateServiceRuntimeConfig({
        serviceId: serviceResult.service.id,
        logging: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 32,
          maxFiles: 4,
          allowSourceOverride: false
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(enabled.status).toBe("ok");

      const withLogging = await triggerDeploy({
        serviceId: serviceResult.service.id,
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(withLogging.status).toBe("ok");
      if (withLogging.status !== "ok") {
        throw new Error("Expected managed logging deployment to queue.");
      }
      expect(
        asRecord(asRecord(withLogging.deployment.configSnapshot).runtimeConfig).logging
      ).toEqual({
        managed: true,
        driver: "json-file",
        maxSizeMb: 32,
        maxFiles: 4,
        allowSourceOverride: false
      });

      const removed = await updateServiceRuntimeConfig({
        serviceId: serviceResult.service.id,
        logging: null,
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(removed.status).toBe("ok");

      const afterRemoval = await triggerDeploy({
        serviceId: serviceResult.service.id,
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(afterRemoval.status).toBe("ok");
      if (afterRemoval.status !== "ok") {
        throw new Error("Expected removal deployment to queue.");
      }
      expect(asRecord(afterRemoval.deployment.configSnapshot)).toHaveProperty(
        "runtimeConfig",
        null
      );
    } finally {
      repository.cleanup();
    }
  });
});
