import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { deriveComposePreviewMetadata } from "../../compose-preview";
import { db } from "../connection";
import { cliAuthRequests } from "../schema/cli-auth";
import { deployments } from "../schema/deployments";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";
import {
  UPLOADED_ARTIFACT_RETENTION_MS,
  persistUploadedArtifacts
} from "../../worker/uploaded-artifacts";
import {
  getOperationalMaintenanceReport,
  runOperationalMaintenanceOnce
} from "./operational-maintenance";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

function suffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

async function createMaintenanceFixture() {
  const projectResult = await createProject({
    name: `maintenance-project-${suffix()}`,
    description: "Maintenance fixture",
    teamId: "team_foundation",
    repoUrl: repoRoot,
    defaultBranch: "main",
    composePath: "docker-compose.dev.yml",
    ...actor
  });
  if (projectResult.status !== "ok") {
    throw new Error(`Failed to create project fixture: ${projectResult.status}`);
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `maintenance-env-${suffix()}`,
    targetServerId: "srv_foundation_1",
    ...actor
  });
  if (environmentResult.status !== "ok") {
    throw new Error(`Failed to create environment fixture: ${environmentResult.status}`);
  }

  const serviceResult = await createService({
    name: "api",
    environmentId: environmentResult.environment.id,
    projectId: projectResult.project.id,
    sourceType: "compose",
    composeServiceName: "api",
    targetServerId: "srv_foundation_1",
    preview: {
      enabled: true,
      mode: "pull-request",
      domainTemplate: "{service}-{pr}.example.test",
      staleAfterHours: 1
    },
    ...actor
  });
  if (serviceResult.status !== "ok") {
    throw new Error(`Failed to create service fixture: ${serviceResult.status}`);
  }

  return {
    project: projectResult.project,
    environment: environmentResult.environment,
    service: serviceResult.service
  };
}

describe("operational maintenance", () => {
  let stagingRoot: string | null = null;
  const originalGitWorkDir = process.env.GIT_WORK_DIR;

  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    stagingRoot = mkdtempSync(join(tmpdir(), "daoflow-maintenance-"));
    process.env.GIT_WORK_DIR = stagingRoot;
  });

  afterEach(() => {
    if (stagingRoot) {
      rmSync(stagingRoot, { recursive: true, force: true });
      stagingRoot = null;
    }

    if (originalGitWorkDir) {
      process.env.GIT_WORK_DIR = originalGitWorkDir;
    } else {
      delete process.env.GIT_WORK_DIR;
    }
  });

  it("reports stalled deployments, stale previews, expired CLI auth requests, and retained artifacts", async () => {
    const fixture = await createMaintenanceFixture();
    const now = new Date("2026-03-28T18:30:00.000Z");
    const previewMetadata = deriveComposePreviewMetadata({
      config: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "{service}-{pr}.example.test",
        staleAfterHours: 1
      },
      request: {
        target: "pull-request",
        branch: "feature/cleanup",
        pullRequestNumber: 42,
        action: "deploy"
      },
      projectName: fixture.project.name,
      environmentName: fixture.environment.name,
      serviceName: fixture.service.name,
      baseStackName: fixture.project.name
    });

    await db.insert(deployments).values([
      {
        id: `depstale${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "worker",
        sourceType: "compose",
        commitSha: "1111111111111111111111111111111111111111",
        imageTag: "ghcr.io/example/worker:stalled",
        status: "deploy",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name
        },
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 31 * 60 * 1000)
      },
      {
        id: `depprev${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: fixture.service.name,
        sourceType: "compose",
        commitSha: "2222222222222222222222222222222222222222",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: previewMetadata.stackName,
          preview: previewMetadata
        },
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        concludedAt: new Date(now.getTime() - 110 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 110 * 60 * 1000)
      }
    ]);

    await db.insert(cliAuthRequests).values({
      id: `cliexp${suffix()}`.slice(0, 32),
      userCode: "ABC12345",
      exchangeCode: null,
      sessionTokenEncrypted: null,
      approvedByUserId: null,
      approvedByEmail: null,
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 10 * 60 * 1000),
      approvedAt: null,
      exchangedAt: null
    });

    const sourceDir = join(stagingRoot as string, "source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "compose.yaml"), "services:\n  api:\n    image: hello-world\n", {
      flag: "w"
    });
    const artifact = await persistUploadedArtifacts({
      sourceDir,
      composeFileName: "compose.yaml"
    });
    utimesSync(
      join(stagingRoot as string, "uploaded-artifacts", artifact.artifactId),
      new Date(now.getTime() - UPLOADED_ARTIFACT_RETENTION_MS - 60_000),
      new Date(now.getTime() - UPLOADED_ARTIFACT_RETENTION_MS - 60_000)
    );

    const report = await getOperationalMaintenanceReport({ now });

    expect(report.current.stalledDeployments.eligibleCount).toBe(1);
    expect(report.current.stalePreviews.eligibleCount).toBe(1);
    expect(report.current.expiredCliAuthRequests.eligibleCount).toBe(1);
    expect(report.current.retainedArtifacts.eligibleCount).toBe(1);
  });

  it("runs the cleanup cycle and records the last manual run", async () => {
    const fixture = await createMaintenanceFixture();
    const now = new Date("2026-03-28T18:30:00.000Z");
    const previewMetadata = deriveComposePreviewMetadata({
      config: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "{service}-{pr}.example.test",
        staleAfterHours: 1
      },
      request: {
        target: "pull-request",
        branch: "feature/cleanup",
        pullRequestNumber: 77,
        action: "deploy"
      },
      projectName: fixture.project.name,
      environmentName: fixture.environment.name,
      serviceName: fixture.service.name,
      baseStackName: fixture.project.name
    });

    await db.insert(deployments).values([
      {
        id: `depstale${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "worker",
        sourceType: "compose",
        commitSha: "3333333333333333333333333333333333333333",
        imageTag: "ghcr.io/example/worker:stalled",
        status: "deploy",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name
        },
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 31 * 60 * 1000)
      },
      {
        id: `depprev${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: fixture.service.name,
        sourceType: "compose",
        commitSha: "4444444444444444444444444444444444444444",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: previewMetadata.stackName,
          preview: previewMetadata
        },
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        concludedAt: new Date(now.getTime() - 110 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 110 * 60 * 1000)
      }
    ]);

    await db.insert(cliAuthRequests).values({
      id: `cliexp${suffix()}`.slice(0, 32),
      userCode: "ZXCV1234",
      exchangeCode: null,
      sessionTokenEncrypted: null,
      approvedByUserId: null,
      approvedByEmail: null,
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 10 * 60 * 1000),
      approvedAt: null,
      exchangedAt: null
    });

    const sourceDir = join(stagingRoot as string, "source");
    rmSync(sourceDir, { recursive: true, force: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "compose.yaml"), "services:\n  api:\n    image: hello-world\n", {
      flag: "w"
    });
    const artifact = await persistUploadedArtifacts({
      sourceDir,
      composeFileName: "compose.yaml"
    });
    utimesSync(
      join(stagingRoot as string, "uploaded-artifacts", artifact.artifactId),
      new Date(now.getTime() - UPLOADED_ARTIFACT_RETENTION_MS - 60_000),
      new Date(now.getTime() - UPLOADED_ARTIFACT_RETENTION_MS - 60_000)
    );

    const result = await runOperationalMaintenanceOnce({
      now,
      trigger: "manual",
      ...actor
    });

    expect(result.stalledDeployments.failedCount).toBe(1);
    expect(result.stalePreviews.queuedCount).toBe(1);
    expect(result.expiredCliAuthRequests.deletedCount).toBe(1);
    expect(result.retainedArtifacts.prunedCount).toBe(1);

    const latestReport = await getOperationalMaintenanceReport({ now });
    expect(latestReport.latestRun?.action).toBe("maintenance.cleanup.run");
    expect(latestReport.latestRun?.summary).toContain("Cleanup processed");
  });
});
