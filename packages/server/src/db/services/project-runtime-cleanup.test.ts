import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cleanupComposeProjectRuntimeMock,
  cleanupContainerRuntimeMock,
  cleanupSwarmStackRuntimeMock
} = vi.hoisted(() => ({
  cleanupComposeProjectRuntimeMock: vi.fn(),
  cleanupContainerRuntimeMock: vi.fn(),
  cleanupSwarmStackRuntimeMock: vi.fn()
}));

vi.mock("../../worker/runtime-cleanup", () => {
  return {
    cleanupComposeProjectRuntime: cleanupComposeProjectRuntimeMock,
    cleanupContainerRuntime: cleanupContainerRuntimeMock,
    cleanupSwarmStackRuntime: cleanupSwarmStackRuntimeMock
  };
});

import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { resetSeededTestDatabase } from "../../test-db";
import { createEnvironment, createProject } from "./projects";
import { cleanupProjectRuntime } from "./project-runtime-cleanup";

function suffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

async function createProjectFixture() {
  const projectResult = await createProject({
    name: `cleanup-project-${suffix()}`,
    description: "Project runtime cleanup fixture",
    teamId: "team_foundation",
    ...actor
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create cleanup fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `cleanup-env-${suffix()}`,
    targetServerId: "srv_foundation_1",
    ...actor
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create cleanup fixture environment.");
  }

  return {
    project: projectResult.project,
    environment: environmentResult.environment
  };
}

describe("cleanupProjectRuntime", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    cleanupComposeProjectRuntimeMock.mockReset();
    cleanupContainerRuntimeMock.mockReset();
    cleanupSwarmStackRuntimeMock.mockReset();
  });

  it("blocks deletion cleanup while deployments are still active", async () => {
    const fixture = await createProjectFixture();

    await db.insert(deployments).values({
      id: `depactive${suffix()}`.slice(0, 32),
      projectId: fixture.project.id,
      environmentId: fixture.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName: "api",
      sourceType: "compose",
      commitSha: "1234567890abcdef1234567890abcdef12345678",
      imageTag: "ghcr.io/example/api:test",
      status: "deploy",
      configSnapshot: {
        projectName: fixture.project.name,
        environmentName: fixture.environment.name
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await cleanupProjectRuntime(fixture.project.id);

    expect(result).toEqual({
      status: "active_deployments",
      message:
        "Project deletion is blocked while deployments are still queued or running. Cancel or wait for them to finish first."
    });
    expect(cleanupComposeProjectRuntimeMock).not.toHaveBeenCalled();
    expect(cleanupContainerRuntimeMock).not.toHaveBeenCalled();
    expect(cleanupSwarmStackRuntimeMock).not.toHaveBeenCalled();
  });

  it("deduplicates cleanup tasks across compose, preview, swarm, and container runtimes", async () => {
    const fixture = await createProjectFixture();
    const swarmServerId = `srvswarm${suffix()}`.slice(0, 32);
    await db.insert(servers).values({
      id: swarmServerId,
      name: `swarm-${suffix()}`,
      host: `swarm-${suffix()}.test`,
      region: "us-west-2",
      sshPort: 22,
      kind: "docker-swarm-manager",
      status: "ready",
      metadata: {},
      registeredByUserId: actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const now = new Date();
    await db.insert(deployments).values([
      {
        id: `depcomp${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "api",
        sourceType: "compose",
        commitSha: "1111111111111111111111111111111111111111",
        imageTag: "ghcr.io/example/api:one",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: "demo"
        },
        createdAt: now,
        concludedAt: now,
        updatedAt: now
      },
      {
        id: `depcomp${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "worker",
        sourceType: "compose",
        commitSha: "2222222222222222222222222222222222222222",
        imageTag: "ghcr.io/example/worker:one",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: "demo"
        },
        createdAt: now,
        concludedAt: now,
        updatedAt: now
      },
      {
        id: `depprev${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "api",
        sourceType: "compose",
        commitSha: "3333333333333333333333333333333333333333",
        imageTag: "ghcr.io/example/api:preview",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: "demo-pr-42"
        },
        createdAt: now,
        concludedAt: now,
        updatedAt: now
      },
      {
        id: `depswarm${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: swarmServerId,
        serviceName: "api",
        sourceType: "compose",
        commitSha: "4444444444444444444444444444444444444444",
        imageTag: "ghcr.io/example/api:swarm",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name,
          stackName: "demo-swarm"
        },
        createdAt: now,
        concludedAt: now,
        updatedAt: now
      },
      {
        id: `depimg${suffix()}`.slice(0, 32),
        projectId: fixture.project.id,
        environmentId: fixture.environment.id,
        targetServerId: "srv_foundation_1",
        serviceName: "jobs",
        sourceType: "image",
        commitSha: "5555555555555555555555555555555555555555",
        imageTag: "ghcr.io/example/jobs:stable",
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          projectName: fixture.project.name,
          environmentName: fixture.environment.name
        },
        createdAt: now,
        concludedAt: now,
        updatedAt: now
      }
    ]);

    cleanupComposeProjectRuntimeMock.mockResolvedValue({
      removedContainers: 1,
      removedNetworks: 1,
      removedVolumes: 1
    });
    cleanupContainerRuntimeMock.mockResolvedValue(undefined);
    cleanupSwarmStackRuntimeMock.mockResolvedValue(undefined);

    const result = await cleanupProjectRuntime(fixture.project.id);

    expect(result).toEqual({
      status: "ok",
      cleanedTargets: 4
    });
    expect(cleanupComposeProjectRuntimeMock).toHaveBeenCalledTimes(2);
    expect(cleanupComposeProjectRuntimeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "remote" }),
      "demo",
      expect.any(Function)
    );
    expect(cleanupComposeProjectRuntimeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "remote" }),
      "demo-pr-42",
      expect.any(Function)
    );
    expect(cleanupSwarmStackRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote", serverKind: "docker-swarm-manager" }),
      "demo-swarm",
      expect.any(Function)
    );
    expect(cleanupContainerRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "remote" }),
      expect.stringContaining("-jobs"),
      expect.any(Function)
    );
  });
});
