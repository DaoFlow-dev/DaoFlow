import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { teams } from "./db/schema/teams";
import { createEnvironment, createProject } from "./db/services/projects";
import { ensureControlPlaneReady } from "./db/services/seed";
import { createService } from "./db/services/services";
import { appRouter } from "./router";

let fixtureCounter = 0;

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

async function createConfigDiffFixture(teamId = "team_foundation") {
  await ensureControlPlaneReady();

  fixtureCounter += 1;
  const suffix = `${Date.now()}_${fixtureCounter}`;
  const projectName = `config-diff-${suffix}`;
  const environmentName = `preview-${suffix}`;
  const serviceName = `svc-${suffix}`;

  if (teamId !== "team_foundation") {
    await db.insert(teams).values({
      id: teamId,
      name: `Scoped Team ${suffix}`,
      slug: `scoped-${suffix}`.slice(0, 40),
      status: "active",
      createdByUserId: "user_foundation_owner"
    });
  }

  const projectResult = await createProject({
    name: projectName,
    description: "Config diff fixture",
    teamId,
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: environmentName,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture environment.");
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
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture service.");
  }

  const baselineDeploymentId = `depbase_${suffix}`.slice(0, 32);
  const comparisonDeploymentId = `depcmp_${suffix}`.slice(0, 32);
  const baselineCreatedAt = new Date(Date.now() - 4 * 60 * 1000);
  const comparisonCreatedAt = new Date(Date.now() - 60 * 1000);

  await db.insert(deployments).values([
    {
      id: baselineDeploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/fixture:1.0.0",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24",
        composePath: `/srv/${serviceName}/compose.v1.yaml`,
        runtime: {
          replicas: 1,
          releaseTrack: "stable"
        }
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: baselineCreatedAt,
      concludedAt: new Date(baselineCreatedAt.getTime() + 30_000),
      updatedAt: new Date(baselineCreatedAt.getTime() + 30_000)
    },
    {
      id: comparisonDeploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "fedcba9",
      imageTag: "ghcr.io/daoflow/fixture:1.1.0",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24",
        composePath: `/srv/${serviceName}/compose.v2.yaml`,
        runtime: {
          replicas: 2,
          releaseTrack: "canary"
        }
      },
      status: "failed",
      conclusion: "failed",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      error: { message: "Fixture failure" },
      createdAt: comparisonCreatedAt,
      concludedAt: new Date(comparisonCreatedAt.getTime() + 20_000),
      updatedAt: new Date(comparisonCreatedAt.getTime() + 20_000)
    }
  ]);

  return {
    baselineDeploymentId,
    comparisonDeploymentId
  };
}

describe("planning diff surfaces", () => {
  it("returns a scoped config diff from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-config-diff",
      session: makeSession("viewer")
    });
    const fixture = await createConfigDiffFixture();

    const diff = await caller.configDiff({
      deploymentIdA: fixture.baselineDeploymentId,
      deploymentIdB: fixture.comparisonDeploymentId
    });

    expect(diff.a.id).toBe(fixture.baselineDeploymentId);
    expect(diff.b.id).toBe(fixture.comparisonDeploymentId);
    expect(diff.summary.sameProject).toBe(true);
    expect(diff.summary.sameEnvironment).toBe(true);
    expect(diff.summary.sameService).toBe(true);
    expect(diff.scalarChanges.map((change) => change.key)).toEqual(
      expect.arrayContaining(["commitSha", "imageTag", "statusLabel"])
    );
    expect(diff.snapshotChanges.map((change) => change.key)).toEqual(
      expect.arrayContaining(["composePath", "runtime"])
    );
  });

  it("keeps deploymentDiff as a scoped compatibility alias", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployment-diff-alias",
      session: makeSession("viewer")
    });
    const fixture = await createConfigDiffFixture();

    const diff = await caller.deploymentDiff({
      deploymentIdA: fixture.baselineDeploymentId,
      deploymentIdB: fixture.comparisonDeploymentId
    });

    expect(diff.summary.changedScalarCount).toBeGreaterThanOrEqual(3);
    expect(diff.summary.changedSnapshotKeyCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects config diff requests outside the caller team scope", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-config-diff-out-of-scope",
      session: makeSession("viewer")
    });
    const outsiderFixture = await createConfigDiffFixture(`team_scope_${Date.now().toString(36)}`);

    await expect(
      caller.configDiff({
        deploymentIdA: outsiderFixture.baselineDeploymentId,
        deploymentIdB: outsiderFixture.comparisonDeploymentId
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
  });
});
