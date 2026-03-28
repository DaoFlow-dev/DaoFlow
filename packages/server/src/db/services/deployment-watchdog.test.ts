import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments } from "../schema/deployments";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  resolveDeploymentWatchdogTimeoutMs,
  runDeploymentWatchdogOnce
} from "./deployment-watchdog";
import { asRecord } from "./json-helpers";

let deploymentWatchdogFixtureCounter = 0;

async function createWatchdogFixture(serviceName: string) {
  deploymentWatchdogFixtureCounter += 1;
  const suffix = `${Date.now()}-${deploymentWatchdogFixtureCounter}`;
  const projectResult = await createProject({
    name: `watchdog-${serviceName}-${suffix}`,
    description: "Watchdog fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create watchdog project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `watchdog-env-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create watchdog environment fixture.");
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
    throw new Error("Failed to create watchdog service fixture.");
  }

  return {
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    serviceName: serviceResult.service.name
  };
}

describe("deployment watchdog", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("marks stale active deployments failed with watchdog metadata and audit evidence", async () => {
    const fixture = await createWatchdogFixture("watchdog-api");
    const now = new Date("2026-03-28T12:00:00.000Z");
    const deploymentId = `depwatch${Date.now()}`.slice(0, 32);

    await db.insert(deployments).values({
      id: deploymentId,
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      targetServerId: "srv_foundation_1",
      serviceName: fixture.serviceName,
      sourceType: "compose",
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      imageTag: "ghcr.io/example/watchdog:test",
      status: "deploy",
      configSnapshot: {
        projectName: "watchdog-project",
        environmentName: "watchdog-env"
      },
      createdAt: new Date(now.getTime() - 20 * 60_000),
      updatedAt: new Date(now.getTime() - 16 * 60_000)
    });

    const result = await runDeploymentWatchdogOnce({
      now,
      timeoutMs: 10 * 60_000
    });

    expect(result.failedCount).toBe(1);
    expect(result.failures[0]).toMatchObject({
      deploymentId,
      previousStatus: "deploy",
      timeoutMs: 10 * 60_000
    });

    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);

    expect(deployment?.status).toBe("failed");
    expect(deployment?.conclusion).toBe("failed");
    expect(asRecord(deployment?.error).code).toBe("DEPLOYMENT_WATCHDOG_TIMEOUT");
    expect(asRecord(asRecord(deployment?.configSnapshot).watchdog).previousStatus).toBe("deploy");

    const logRows = await db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deploymentId));
    expect(logRows.some((row) => row.message.includes("stopped reporting progress"))).toBe(true);

    const auditRows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `deployment/${deploymentId}`));
    expect(auditRows.some((row) => row.action === "deployment.watchdog.fail")).toBe(true);

    const eventRows = await db.select().from(events).where(eq(events.resourceId, deploymentId));
    expect(eventRows.some((row) => row.kind === "deployment.watchdog.failed")).toBe(true);
  });

  it("ignores fresh active deployments and already terminal deployments", async () => {
    const fixture = await createWatchdogFixture("watchdog-worker");
    const now = new Date("2026-03-28T12:00:00.000Z");
    const freshId = `depfresh${Date.now()}`.slice(0, 32);
    const terminalId = `depterm${Date.now()}`.slice(0, 32);

    await db.insert(deployments).values([
      {
        id: freshId,
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: fixture.serviceName,
        sourceType: "compose",
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        imageTag: "ghcr.io/example/watchdog:fresh",
        status: "prepare",
        configSnapshot: {},
        createdAt: new Date(now.getTime() - 5 * 60_000),
        updatedAt: new Date(now.getTime() - 2 * 60_000)
      },
      {
        id: terminalId,
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        targetServerId: "srv_foundation_1",
        serviceName: `${fixture.serviceName}-done`,
        sourceType: "compose",
        commitSha: "cccccccccccccccccccccccccccccccccccccccc",
        imageTag: "ghcr.io/example/watchdog:done",
        status: "failed",
        conclusion: "failed",
        configSnapshot: {},
        createdAt: new Date(now.getTime() - 30 * 60_000),
        concludedAt: new Date(now.getTime() - 29 * 60_000),
        updatedAt: new Date(now.getTime() - 29 * 60_000)
      }
    ]);

    const result = await runDeploymentWatchdogOnce({
      now,
      timeoutMs: 10 * 60_000
    });

    expect(result.failedCount).toBe(0);

    const [fresh, terminal] = await Promise.all([
      db.select().from(deployments).where(eq(deployments.id, freshId)).limit(1),
      db.select().from(deployments).where(eq(deployments.id, terminalId)).limit(1)
    ]);

    expect(fresh[0]?.status).toBe("prepare");
    expect(terminal[0]?.status).toBe("failed");
  });

  it("falls back to the default timeout when the environment override is invalid", () => {
    expect(resolveDeploymentWatchdogTimeoutMs("bad-value")).toBe(15 * 60_000);
    expect(resolveDeploymentWatchdogTimeoutMs("500")).toBe(15 * 60_000);
    expect(resolveDeploymentWatchdogTimeoutMs("120000")).toBe(120000);
  });
});
