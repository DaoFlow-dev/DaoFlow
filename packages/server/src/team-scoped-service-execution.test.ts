import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { environments } from "./db/schema/projects";
import { servers } from "./db/schema/servers";
import { services } from "./db/schema/services";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { createDeploymentRecord } from "./db/services/deployments";
import { resolveTeamIdForUser } from "./db/services/teams";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { createProjectEnvironmentServiceFixture } from "./testing/project-fixtures";
import { makeSession, makeTokenAuthContext } from "./testing/request-auth-fixtures";

const teamBId = "team_scope_execution_b";
const userBId = "user_scope_execution_b";
const serverBId = "srv_scope_execution_b";

const actorB = {
  requestedByUserId: userBId,
  requestedByEmail: "scope-execution-b@daoflow.local",
  requestedByRole: "owner" as const
};

function notFound() {
  return { code: "NOT_FOUND" } satisfies Partial<TRPCError>;
}

function uniqueSuffix() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function expectDatabaseScopeRejection(operation: Promise<unknown>, expectedMessage: string) {
  try {
    await operation;
    throw new Error("Expected the database scope guard to reject the write.");
  } catch (error) {
    const messages: string[] = [];
    const codes: string[] = [];
    let current: unknown = error;
    while (current && typeof current === "object") {
      if ("message" in current && typeof current.message === "string") {
        messages.push(current.message);
      }
      if ("code" in current && typeof current.code === "string") {
        codes.push(current.code);
      }
      current = "cause" in current ? current.cause : null;
    }

    expect(messages.join("\n")).toContain(expectedMessage);
    expect(codes).toContain("23514");
  }
}

async function createSecondTeam() {
  await db.insert(users).values({
    id: userBId,
    email: actorB.requestedByEmail,
    name: "Execution Scope Team B Owner",
    username: userBId,
    emailVerified: true,
    role: "owner",
    status: "active",
    defaultTeamId: teamBId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await db.insert(teams).values({
    id: teamBId,
    name: "Execution Scope Team B",
    slug: "execution-scope-team-b",
    status: "active",
    createdByUserId: userBId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await db.insert(teamMembers).values({
    id: 9001,
    teamId: teamBId,
    userId: userBId,
    role: "owner",
    createdAt: new Date()
  });
  await db.insert(servers).values({
    id: serverBId,
    name: "execution-scope-team-b-server",
    host: "198.51.100.202",
    region: "test",
    teamId: teamBId,
    sshPort: 22,
    kind: "docker-engine",
    status: "pending host identity approval",
    metadata: {},
    registeredByUserId: userBId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

async function createTeamBFixture() {
  const suffix = uniqueSuffix();
  const fixture = await createProjectEnvironmentServiceFixture({
    project: {
      name: `Execution Scope Project B ${suffix}`,
      description: "Cross-team execution fixture",
      teamId: teamBId
    },
    environment: {
      teamId: teamBId,
      name: `production-${suffix}`,
      targetServerId: serverBId
    },
    service: {
      name: `execution-api-${suffix}`,
      sourceType: "compose",
      targetServerId: serverBId
    },
    requester: actorB
  });

  return fixture;
}

async function createTeamAFixture() {
  const suffix = uniqueSuffix();
  return createProjectEnvironmentServiceFixture({
    project: {
      name: `Execution Scope Project A ${suffix}`,
      description: "Same-team execution fixture",
      teamId: "team_foundation"
    },
    environment: {
      name: `staging-${suffix}`,
      targetServerId: "srv_foundation_1"
    },
    service: {
      name: `execution-api-${suffix}`,
      sourceType: "compose",
      targetServerId: "srv_foundation_1"
    }
  });
}

function createTeamACaller(requestId: string) {
  return appRouter.createCaller({
    requestId,
    session: makeSession("owner")
  });
}

describe("team-scoped service and deployment execution", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await createSecondTeam();
  });

  it("rejects environment and service writes that target another team's server", async () => {
    const fixtureA = await createTeamAFixture();
    const callerA = createTeamACaller("team-scope-target-server");

    await expect(
      callerA.createEnvironment({
        projectId: fixtureA.project.id,
        name: `blocked-environment-${uniqueSuffix()}`,
        targetServerId: serverBId
      })
    ).rejects.toMatchObject(notFound());

    await expect(
      callerA.updateEnvironment({
        environmentId: fixtureA.environment.id,
        targetServerId: serverBId
      })
    ).rejects.toMatchObject(notFound());

    await expect(
      callerA.createService({
        projectId: fixtureA.project.id,
        environmentId: fixtureA.environment.id,
        name: `blocked-service-${uniqueSuffix()}`,
        sourceType: "compose",
        targetServerId: serverBId
      })
    ).rejects.toMatchObject(notFound());

    await expect(
      callerA.updateService({
        serviceId: fixtureA.service.id,
        targetServerId: serverBId
      })
    ).rejects.toMatchObject(notFound());

    const deniedAudits = await db
      .select()
      .from(auditEntries)
      .where(
        inArray(auditEntries.action, [
          "environment.target-server.denied",
          "service.target-server.denied"
        ])
      );
    expect(deniedAudits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["environment.target-server.denied", "service.target-server.denied"])
    );
    for (const entry of deniedAudits) {
      expect(
        JSON.stringify({
          targetResource: entry.targetResource,
          inputSummary: entry.inputSummary,
          metadata: entry.metadata
        })
      ).not.toContain(serverBId);
    }
  });

  it("does not fall back to another team when the caller has no membership", async () => {
    await db.delete(teamMembers).where(eq(teamMembers.userId, "user_foundation_owner"));
    expect(await resolveTeamIdForUser("user_foundation_owner")).toBeNull();

    const callerA = createTeamACaller("team-scope-no-membership");
    await expect(callerA.recentDeployments({ limit: 10 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED"
    });
    await expect(
      callerA.createDeploymentRecord({
        projectName: "Foundation API",
        environmentName: "production",
        serviceName: "api",
        sourceType: "compose",
        targetServerId: "srv_foundation_1",
        commitSha: "abcdef0",
        imageTag: "ghcr.io/daoflow/no-membership:blocked",
        steps: [{ label: "Prepare", detail: "Should not enter another team." }]
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects deployment creation when an owned project names another team's server", async () => {
    const fixtureA = await createTeamAFixture();
    const callerA = createTeamACaller("team-scope-deployment-create");

    await expect(
      callerA.createDeploymentRecord({
        projectName: fixtureA.project.name,
        environmentName: fixtureA.environment.name,
        serviceName: fixtureA.service.name,
        sourceType: "compose",
        targetServerId: serverBId,
        commitSha: "abcdef1",
        imageTag: "ghcr.io/daoflow/cross-team:blocked",
        steps: [{ label: "Prepare", detail: "Render deployment inputs." }]
      })
    ).rejects.toMatchObject(notFound());
  });

  it("hides another team's servers from destructive administration", async () => {
    const callerA = createTeamACaller("team-scope-server-administration");

    await expect(callerA.deleteServer({ serverId: serverBId })).rejects.toMatchObject(notFound());
    await expect(
      callerA.configureServerManagedTraefikProxy({
        serverId: serverBId,
        enabled: true,
        networkName: "cross-team-proxy"
      })
    ).rejects.toMatchObject(notFound());

    const [server] = await db.select().from(servers).where(eq(servers.id, serverBId)).limit(1);
    expect(server).toMatchObject({
      id: serverBId,
      teamId: teamBId,
      status: "pending host identity approval",
      metadata: {}
    });
  });

  it("ignores a caller-supplied team when creating a project", async () => {
    const callerA = createTeamACaller("team-scope-project-create");
    const maliciousInput = {
      name: `Caller Scoped Project ${uniqueSuffix()}`,
      teamId: teamBId
    };

    const project = await callerA.createProject(maliciousInput);

    expect(project.teamId).toBe("team_foundation");
  });

  it("keeps the execution-scope invariant when records are written directly", async () => {
    const fixtureA = await createTeamAFixture();
    const deployment = await createDeploymentRecord({
      deploymentId: "dep_scope_execution_a",
      serviceId: fixtureA.service.id,
      projectName: fixtureA.project.name,
      environmentName: fixtureA.environment.name,
      serviceName: fixtureA.service.name,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      commitSha: "abcdef3",
      imageTag: "ghcr.io/daoflow/team-a:queued",
      steps: [{ label: "Prepare", detail: "Queue team A deployment." }]
    });
    expect(deployment).not.toBeNull();

    await expectDatabaseScopeRejection(
      db
        .update(environments)
        .set({ config: { targetServerId: serverBId } })
        .where(eq(environments.id, fixtureA.environment.id)),
      "environment target server must belong to the project team"
    );

    await expectDatabaseScopeRejection(
      db
        .update(services)
        .set({ targetServerId: serverBId })
        .where(eq(services.id, fixtureA.service.id)),
      "service target server must belong to the project team"
    );

    await expectDatabaseScopeRejection(
      db
        .update(deployments)
        .set({ targetServerId: serverBId })
        .where(eq(deployments.id, "dep_scope_execution_a")),
      "deployment target server must belong to the project team"
    );

    await expectDatabaseScopeRejection(
      db.update(servers).set({ teamId: teamBId }).where(eq(servers.id, "srv_foundation_1")),
      "server team cannot change while scoped execution targets reference it"
    );
  });

  it("hides another team's deployments from reads and execution mutations", async () => {
    const fixtureB = await createTeamBFixture();
    const deploymentId = "dep_scope_execution_b";
    const deployment = await createDeploymentRecord({
      deploymentId,
      serviceId: fixtureB.service.id,
      projectName: fixtureB.project.name,
      environmentName: fixtureB.environment.name,
      serviceName: fixtureB.service.name,
      sourceType: "compose",
      targetServerId: serverBId,
      teamId: teamBId,
      requestedByUserId: userBId,
      requestedByEmail: actorB.requestedByEmail,
      requestedByRole: actorB.requestedByRole,
      commitSha: "abcdef2",
      imageTag: "ghcr.io/daoflow/team-b:queued",
      steps: [{ label: "Prepare", detail: "Queue team B deployment." }]
    });

    expect(deployment).not.toBeNull();
    if (!deployment) {
      throw new Error("Failed to create the team B deployment fixture.");
    }

    const callerA = createTeamACaller("team-scope-deployment-reads");
    const recent = await callerA.recentDeployments({ limit: 50 });
    const logs = await callerA.deploymentLogs({ deploymentId });
    const allLogs = await callerA.deploymentLogs({ limit: 100 });
    const queue = await callerA.executionQueue({ limit: 50 });

    expect(recent.map((item) => item.id)).not.toContain(deployment.id);
    expect(logs).toMatchObject({
      summary: { totalLines: 0, stderrLines: 0, deploymentCount: 0 },
      lines: []
    });
    expect(allLogs.lines.map((line) => line.deploymentId)).not.toContain(deployment.id);
    expect(queue.jobs.map((job) => job.deploymentId)).not.toContain(deployment.id);

    await expect(
      callerA.deploymentDetails({ deploymentId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.cancelDeployment({ deploymentId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.dispatchExecutionJob({ jobId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.completeExecutionJob({ jobId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.failExecutionJob({
        jobId: "dep_scope_execution_b",
        reason: "Cross-team execution attempt"
      })
    ).rejects.toMatchObject(notFound());

    const tokenCallerA = appRouter.createCaller({
      requestId: "team-scope-deployment-token",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read", "deploy:start", "deploy:cancel"])
    });

    await expect(
      tokenCallerA.deploymentDetails({ deploymentId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      tokenCallerA.cancelDeployment({ deploymentId: "dep_scope_execution_b" })
    ).rejects.toMatchObject(notFound());
    await expect(
      tokenCallerA.triggerDeploy({ serviceId: fixtureB.service.id })
    ).rejects.toMatchObject(notFound());
  });
});
