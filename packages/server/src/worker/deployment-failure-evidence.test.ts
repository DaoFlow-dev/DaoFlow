import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { events } from "../db/schema/audit";
import { deploymentLogs, deployments } from "../db/schema/deployments";
import { buildDeploymentRecoveryGuidance } from "../db/services/deployment-recovery-guidance";
import { createEnvironment, createProject } from "../db/services/projects";
import { createService } from "../db/services/services";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import {
  recordDeploymentFailureEvidence,
  safeDeploymentFailureMessage
} from "./deployment-failure-evidence";

async function createFixture() {
  const suffix = Date.now().toString(36);
  const project = await createProject({
    name: `failure-evidence-${suffix}`,
    description: "Failure evidence fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (project.status !== "ok") throw new Error("Unable to create project fixture.");
  const environment = await createEnvironment({
    projectId: project.project.id,
    name: `failure-env-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environment.status !== "ok") throw new Error("Unable to create environment fixture.");
  const service = await createService({
    name: `failure-service-${suffix}`,
    projectId: project.project.id,
    environmentId: environment.environment.id,
    sourceType: "image",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (service.status !== "ok") throw new Error("Unable to create service fixture.");
  const deploymentId = `depfail${Date.now()}`.slice(0, 32);
  const [deployment] = await db
    .insert(deployments)
    .values({
      id: deploymentId,
      projectId: project.project.id,
      environmentId: environment.environment.id,
      targetServerId: "srv_foundation_1",
      serviceId: service.service.id,
      serviceName: service.service.name,
      sourceType: "image",
      imageTag: "missing.invalid/example:never",
      status: "failed",
      conclusion: "failed",
      configSnapshot: {
        insight: {
          healthyBaseline: { deploymentId: "dep_known_good" }
        }
      },
      updatedAt: new Date()
    })
    .returning();
  return deployment;
}

describe("deployment failure evidence", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("persists exact redacted evidence once and exposes resolvable IDs", async () => {
    const deployment = await createFixture();
    const secret = "ghp_1234567890abcdefghijklmnopqrstuv";
    const error = new Error(`pull failed Authorization: Bearer ${secret}`);
    const first = await recordDeploymentFailureEvidence(deployment, error, "test-worker");
    const second = await recordDeploymentFailureEvidence(deployment, error, "test-worker");
    expect(second).toEqual(first);

    const [current] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id))
      .limit(1);
    const [eventRows, logRows] = await Promise.all([
      db.select().from(events).where(eq(events.resourceId, deployment.id)),
      db.select().from(deploymentLogs).where(eq(deploymentLogs.deploymentId, deployment.id))
    ]);
    expect(eventRows).toHaveLength(1);
    expect(logRows).toHaveLength(1);
    expect(eventRows[0]?.id).toBe(first.eventId);
    expect(logRows[0]?.id).toBe(first.logId);

    const guidance = current ? buildDeploymentRecoveryGuidance(current) : null;
    expect(guidance?.evidenceIds).toEqual([
      `event:${first.eventId}`,
      `deployment-log:${first.logId}`
    ]);
    expect(JSON.stringify({ current, eventRows, logRows, guidance })).not.toContain(secret);
    expect(JSON.stringify({ current, eventRows, logRows, guidance })).not.toContain("Bearer");
    expect(guidance?.evidence[0]).toMatchObject({
      eventId: first.eventId,
      logId: first.logId
    });
  });

  it("redacts token-shaped failure text", () => {
    expect(safeDeploymentFailureMessage("password=hunter2 token=abc123")).toBe(
      "[redacted] [redacted]"
    );
  });
});
