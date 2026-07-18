import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rcloneMocks = vi.hoisted(() => ({
  listRemoteJson: vi.fn(),
  testConnection: vi.fn()
}));

vi.mock("./worker/rclone-executor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./worker/rclone-executor")>()),
  listRemoteJson: rcloneMocks.listRemoteJson,
  testConnection: rcloneMocks.testConnection
}));

import { appRouter } from "./router";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { containerRegistries } from "./db/schema/registries";
import { servers } from "./db/schema/servers";
import { backupPolicies, backupRuns, volumes } from "./db/schema/storage";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { listContainerRegistryCredentialsForProjectImageReferences } from "./db/services/container-registry-credentials";
import { registerContainerRegistry } from "./db/services/container-registries";
import { resolveMemberTeamIdForUser } from "./db/services/teams";
import { createProjectEnvironmentServiceFixture } from "./testing/project-fixtures";
import { makeCustomSession, makeSession } from "./testing/request-auth-fixtures";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { resolveBackupPolicy } from "./worker/temporal/activities/backup-policy-resolution";
import { resolveRestoreContext } from "./worker/temporal/activities/restore-activities";

const teamBId = "team_scope_b";
const userBId = "user_scope_b";
const serverBId = "srv_scope_b";
const actorA = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};
const actorB = {
  requestedByUserId: userBId,
  requestedByEmail: "scope-b@daoflow.local",
  requestedByRole: "owner" as const
};

function notFound() {
  return { code: "NOT_FOUND" } satisfies Partial<TRPCError>;
}

async function createSecondTeam() {
  await db.insert(teams).values({
    id: teamBId,
    name: "Scope Team B",
    slug: "scope-team-b",
    updatedAt: new Date()
  });
  await db.insert(users).values({
    id: userBId,
    email: actorB.requestedByEmail,
    name: "Scope Team B Owner",
    role: "owner",
    defaultTeamId: teamBId,
    updatedAt: new Date()
  });
  await db.insert(teamMembers).values({ teamId: teamBId, userId: userBId, role: "owner" });
  await db.insert(servers).values({
    id: serverBId,
    name: "scope-team-b-server",
    host: "203.0.113.202",
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

async function createScopedService(teamId: string, actor: typeof actorA | typeof actorB) {
  const suffix = randomUUID().slice(0, 8);
  const targetServerId = teamId === teamBId ? serverBId : "srv_foundation_1";
  return createProjectEnvironmentServiceFixture({
    project: { name: `Scoped Project ${suffix}`, teamId },
    environment: { name: `production-${suffix}`, targetServerId },
    service: {
      name: `api-${suffix}`,
      sourceType: "compose",
      targetServerId
    },
    requester: actor
  });
}

describe("team-scoped backup destinations and container registries", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await createSecondTeam();
    rcloneMocks.listRemoteJson.mockReset();
    rcloneMocks.listRemoteJson.mockResolvedValue([{ path: "team-safe-backup.tar" }]);
    rcloneMocks.testConnection.mockReset();
    rcloneMocks.testConnection.mockReturnValue({ success: true, output: "connected" });
  });

  it("isolates destination and registry reads, writes, browse, tests, policies, and worker credentials", async () => {
    const callerA = appRouter.createCaller({
      requestId: "team-scope-a",
      session: makeSession("owner")
    });
    const callerB = appRouter.createCaller({
      requestId: "team-scope-b",
      session: makeCustomSession({
        id: userBId,
        email: actorB.requestedByEmail,
        name: "Scope Team B Owner",
        role: "owner"
      })
    });
    const [serviceA, serviceB] = await Promise.all([
      createScopedService("team_foundation", actorA),
      createScopedService(teamBId, actorB)
    ]);

    const destinationA = await callerA.createBackupDestination({
      name: "Team A backups",
      provider: "local",
      localPath: "/tmp/team-a"
    });
    const destinationB = await callerB.createBackupDestination({
      name: "Team B backups",
      provider: "local",
      localPath: "/tmp/team-b"
    });

    expect((await callerA.backupDestinations({})).map((destination) => destination.id)).toEqual([
      destinationA.id
    ]);
    expect((await callerB.backupDestinations({})).map((destination) => destination.id)).toEqual([
      destinationB.id
    ]);
    await expect(
      callerA.backupDestination({ destinationId: destinationB.id })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.updateBackupDestination({ id: destinationB.id, name: "stolen" })
    ).rejects.toMatchObject(notFound());
    await expect(callerA.deleteBackupDestination({ id: destinationB.id })).rejects.toMatchObject(
      notFound()
    );
    await expect(callerA.testBackupDestination({ id: destinationB.id })).rejects.toMatchObject(
      notFound()
    );
    await expect(callerA.listDestinationFiles({ id: destinationB.id })).rejects.toMatchObject(
      notFound()
    );
    await expect(callerB.testBackupDestination({ id: destinationB.id })).resolves.toMatchObject({
      success: true
    });
    await expect(callerB.listDestinationFiles({ id: destinationB.id })).resolves.toEqual([
      { path: "team-safe-backup.tar" }
    ]);

    const volumeA = await callerA.createVolume({
      name: "team-a-volume",
      serverId: "srv_foundation_1",
      mountPath: "/srv/team-a",
      serviceId: serviceA.service.id
    });
    const volumeB = await callerB.createVolume({
      name: "team-b-volume",
      serverId: serverBId,
      mountPath: "/srv/team-b",
      serviceId: serviceB.service.id
    });
    await expect(
      callerA.createBackupPolicy({
        name: "cross-team-policy",
        volumeId: volumeA.id,
        destinationId: destinationB.id
      })
    ).rejects.toMatchObject(notFound());

    const policyA = await callerA.createBackupPolicy({
      name: "team-a-policy",
      volumeId: volumeA.id,
      destinationId: destinationA.id
    });
    expect(await resolveMemberTeamIdForUser(userBId)).toBe(teamBId);
    await expect(
      callerB.createBackupPolicy({
        name: "team-b-policy",
        volumeId: volumeB.id,
        destinationId: destinationB.id
      })
    ).resolves.toMatchObject({ destinationId: destinationB.id });

    await db
      .update(backupPolicies)
      .set({ destinationId: destinationB.id })
      .where(eq(backupPolicies.id, policyA.id));
    await db.insert(backupRuns).values({
      id: "brun_scope_cross_team",
      policyId: policyA.id,
      status: "succeeded",
      artifactPath: "team-a-policy/backup.tar",
      createdAt: new Date()
    });
    await expect(resolveBackupPolicy(policyA.id)).resolves.toBeNull();
    await expect(
      resolveRestoreContext({
        backupRunId: "brun_scope_cross_team",
        triggeredBy: actorA.requestedByUserId
      })
    ).resolves.toBeNull();

    const registryA = await callerA.registerContainerRegistry({
      name: "Shared GHCR",
      registryHost: "ghcr.io",
      username: "team-a",
      password: "team-a-token"
    });
    const registryB = await callerB.registerContainerRegistry({
      name: "Shared GHCR",
      registryHost: "ghcr.io",
      username: "team-b",
      password: "team-b-token"
    });

    const destinationAudit = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `backup-destination/${destinationA.id}`))
      .limit(1);
    expect(destinationAudit[0]).toMatchObject({
      organizationId: "team_foundation",
      metadata: { teamId: "team_foundation" }
    });
    const registryAudit = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `container_registry/${registryA.id}`))
      .limit(1);
    expect(registryAudit[0]).toMatchObject({
      organizationId: "team_foundation",
      metadata: { teamId: "team_foundation" }
    });

    expect((await callerA.containerRegistries()).map((registry) => registry.id)).toEqual([
      registryA.id
    ]);
    expect((await callerB.containerRegistries()).map((registry) => registry.id)).toEqual([
      registryB.id
    ]);
    await expect(
      callerA.updateContainerRegistry({
        registryId: registryB.id,
        name: "cross-team",
        registryHost: "ghcr.io",
        username: "team-a"
      })
    ).rejects.toMatchObject(notFound());
    await expect(
      callerA.deleteContainerRegistry({ registryId: registryB.id })
    ).rejects.toMatchObject(notFound());

    await expect(
      listContainerRegistryCredentialsForProjectImageReferences(serviceA.project.id, [
        "ghcr.io/example/api:latest"
      ])
    ).resolves.toEqual([
      expect.objectContaining({ id: registryA.id, username: "team-a", password: "team-a-token" })
    ]);
    await expect(
      listContainerRegistryCredentialsForProjectImageReferences(serviceB.project.id, [
        "ghcr.io/example/api:latest"
      ])
    ).resolves.toEqual([
      expect.objectContaining({ id: registryB.id, username: "team-b", password: "team-b-token" })
    ]);
  });

  it("uses the owning server team for a legacy volume without project metadata", async () => {
    await db.insert(volumes).values({
      id: "vol_unowned_legacy",
      name: "unowned-legacy",
      serverId: "srv_foundation_1",
      mountPath: "/srv/unowned",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const callerB = appRouter.createCaller({
      requestId: "team-scope-unowned-volume",
      session: makeCustomSession({
        id: userBId,
        email: actorB.requestedByEmail,
        name: "Scope Team B Owner",
        role: "owner"
      })
    });

    await expect(
      callerB.createBackupPolicy({ name: "must-not-adopt", volumeId: "vol_unowned_legacy" })
    ).rejects.toMatchObject(notFound());
  });

  it("returns a stable conflict when same-team registry creation races", async () => {
    const create = () =>
      registerContainerRegistry({
        ...actorA,
        teamId: "team_foundation",
        name: "Race Registry",
        registryHost: "race.example.com",
        username: "runner",
        password: "race-token"
      });

    const results = await Promise.all([create(), create()]);
    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
    const rows = await db
      .select()
      .from(containerRegistries)
      .where(eq(containerRegistries.registryHost, "race.example.com"));
    expect(rows).toHaveLength(1);
  });
});
