import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import {
  claimDeploymentForExecution,
  claimNextQueuedDeploymentForExecution
} from "./deployment-execution-control";
import { cancelDeployment } from "./deployments";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { asRecord } from "./json-helpers";

let deploymentControlFixtureCounter = 0;

async function createDeploymentFixture(serviceName: string) {
  deploymentControlFixtureCounter += 1;
  const suffix = `${Date.now()}-${deploymentControlFixtureCounter}`;
  const uniquePrefix = `dc${deploymentControlFixtureCounter}`;

  const projectResult = await createProject({
    name: `${uniquePrefix}-${serviceName}-${suffix}`,
    description: "Deployment control fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create deployment control fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `${uniquePrefix}-env-${serviceName}-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create deployment control fixture environment.");
  }

  const serviceResult = await createService({
    name: serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create deployment control fixture service.");
  }

  return {
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    serviceName: serviceResult.service.name
  };
}

describe("deployment execution control", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("skips queued deployments whose service already has an active execution", async () => {
    const primary = await createDeploymentFixture("api");
    const secondary = await createDeploymentFixture("worker");
    const activeCreatedAt = new Date("2000-01-01T00:00:00.000Z");
    const blockedCreatedAt = new Date("2000-01-02T00:00:00.000Z");
    const eligibleCreatedAt = new Date("2000-01-03T00:00:00.000Z");
    const now = Date.now();

    await db.insert(deployments).values([
      {
        id: `depactive${now}`.slice(0, 32),
        projectId: primary.projectId,
        environmentId: primary.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: primary.serviceName,
        sourceType: "compose",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        imageTag: "ghcr.io/example/api:active",
        status: "deploy",
        configSnapshot: {},
        createdAt: activeCreatedAt,
        updatedAt: activeCreatedAt
      },
      {
        id: `depblocked${now}`.slice(0, 32),
        projectId: primary.projectId,
        environmentId: primary.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: primary.serviceName,
        sourceType: "compose",
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        imageTag: "ghcr.io/example/api:queued",
        status: "queued",
        configSnapshot: {},
        createdAt: blockedCreatedAt,
        updatedAt: blockedCreatedAt
      },
      {
        id: `depother${now}`.slice(0, 32),
        projectId: secondary.projectId,
        environmentId: secondary.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: secondary.serviceName,
        sourceType: "compose",
        commitSha: "cccccccccccccccccccccccccccccccccccccccc",
        imageTag: "ghcr.io/example/worker:queued",
        status: "queued",
        configSnapshot: {},
        createdAt: eligibleCreatedAt,
        updatedAt: eligibleCreatedAt
      }
    ]);

    const claimed = await claimNextQueuedDeploymentForExecution({
      actorId: "execution-worker",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      actorLabel: "execution-worker"
    });

    expect(claimed?.serviceName).toBe(secondary.serviceName);

    const [blocked] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, `depblocked${now}`.slice(0, 32)))
      .limit(1);

    expect(blocked?.status).toBe("queued");
  });

  it("waits to claim a specific queued deployment until the same service is idle", async () => {
    const fixture = await createDeploymentFixture("serialized-api");
    const now = Date.now();
    const activeId = `depbusy${now}`.slice(0, 32);
    const queuedId = `depwait${now}`.slice(0, 32);

    await db.insert(deployments).values([
      {
        id: activeId,
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: fixture.serviceName,
        sourceType: "compose",
        commitSha: "dddddddddddddddddddddddddddddddddddddddd",
        imageTag: "ghcr.io/example/api:busy",
        status: "prepare",
        configSnapshot: {},
        createdAt: new Date(now - 2_000),
        updatedAt: new Date(now - 2_000)
      },
      {
        id: queuedId,
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: fixture.serviceName,
        sourceType: "compose",
        commitSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        imageTag: "ghcr.io/example/api:queued",
        status: "queued",
        configSnapshot: {},
        createdAt: new Date(now - 1_000),
        updatedAt: new Date(now - 1_000)
      }
    ]);

    const waiting = await claimDeploymentForExecution(queuedId, {
      actorId: "temporal-worker",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      actorLabel: "temporal-worker"
    });
    expect(waiting.status).toBe("waiting");

    await db
      .update(deployments)
      .set({
        status: "failed",
        conclusion: "failed",
        concludedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(deployments.id, activeId));

    const claimed = await claimDeploymentForExecution(queuedId, {
      actorId: "temporal-worker",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      actorLabel: "temporal-worker"
    });
    expect(claimed.status).toBe("claimed");
    expect(claimed.deployment?.status).toBe("prepare");
  });

  it("records active deployment cancellation as a cooperative request", async () => {
    const fixture = await createDeploymentFixture("cancel-api");
    const deploymentId = `depcancel${Date.now()}`.slice(0, 32);

    await db.insert(deployments).values({
      id: deploymentId,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      targetServerId: "srv_foundation_1",
      serviceName: fixture.serviceName,
      sourceType: "compose",
      commitSha: "ffffffffffffffffffffffffffffffffffffffff",
      imageTag: "ghcr.io/example/api:cancel",
      status: "deploy",
      configSnapshot: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await cancelDeployment({
      deploymentId,
      cancelledByUserId: "user_foundation_owner",
      cancelledByEmail: "owner@daoflow.local",
      cancelledByRole: "owner"
    });

    expect(result.status).toBe("cancellation-requested");

    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);

    expect(deployment?.status).toBe("deploy");
    expect(deployment?.conclusion).toBeNull();
    expect(asRecord(deployment?.configSnapshot).cancelRequestedBy).toBe("owner@daoflow.local");
    expect(asRecord(deployment?.configSnapshot).cancelRequestedAt).toEqual(expect.any(String));
  });
});
