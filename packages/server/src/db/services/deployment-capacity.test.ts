import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { deploymentQueueReservations, deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import {
  createDeploymentRecord,
  cancelDeployment,
  type CreateDeploymentInput
} from "./deployments";
import {
  DEPLOYMENT_QUEUE_FULL,
  DeploymentQueueFullError,
  reserveDeploymentQueueSlot
} from "./deployment-capacity";
import { createEnvironment, createProject } from "./projects";
import { configureServerCapacity, ServerCapacityValidationError } from "./server-capacity";
import { appRouter } from "../../router";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { makeSession } from "../../testing/request-auth-fixtures";
import { deployStartProcedure, t } from "../../trpc";
import { listDeploymentRecords } from "./deployment-queries";

const capacityErrorRouter = t.router({
  queueDeployment: deployStartProcedure.mutation(() => {
    throw new DeploymentQueueFullError({
      serverId: "srv_capacity_full",
      maxQueuedDeployments: 20,
      queuedDeploymentCount: 20
    });
  })
});

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner"
} as const;

let fixtureCounter = 0;

function nextFixtureSuffix() {
  fixtureCounter += 1;
  return `${Date.now().toString(36)}-${fixtureCounter}`;
}

async function createCapacityServer() {
  const caller = appRouter.createCaller({
    requestId: `deployment-capacity-server-${nextFixtureSuffix()}`,
    session: makeSession("admin")
  });

  return caller.registerServer({
    name: `capacity-server-${nextFixtureSuffix()}`,
    host: "127.0.0.1",
    region: "test",
    sshPort: 22,
    kind: "docker-engine"
  });
}

async function createDeploymentInput(
  targetServerId: string,
  serviceName: string
): Promise<CreateDeploymentInput> {
  const suffix = nextFixtureSuffix();
  const projectResult = await createProject({
    name: `Capacity Project ${suffix}`,
    description: "Deployment capacity fixture",
    teamId: "team_foundation",
    ...actor
  });
  if (projectResult.status !== "ok" || !projectResult.project) {
    throw new Error("Failed to create deployment capacity project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `capacity-${suffix}`,
    targetServerId,
    ...actor
  });
  if (environmentResult.status !== "ok" || !environmentResult.environment) {
    throw new Error("Failed to create deployment capacity environment fixture.");
  }

  return {
    projectName: projectResult.project.name,
    environmentName: environmentResult.environment.name,
    serviceName,
    sourceType: "compose",
    targetServerId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    imageTag: `ghcr.io/daoflow/${serviceName}:test`,
    teamId: "team_foundation",
    ...actor,
    steps: [{ label: "Queued", detail: "Added to the deployment queue." }]
  };
}

describe("deployment capacity", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("persists default server capacity values", async () => {
    const server = await createCapacityServer();

    expect(server.maxConcurrentBuilds).toBe(1);
    expect(server.maxQueuedDeployments).toBe(20);
  });

  it("requires server write access, validates bounds, and audits capacity changes", async () => {
    const server = await createCapacityServer();
    const viewer = appRouter.createCaller({
      requestId: "deployment-capacity-viewer",
      session: makeSession("viewer")
    });
    const admin = appRouter.createCaller({
      requestId: "deployment-capacity-admin",
      session: makeSession("admin")
    });

    await expect(
      viewer.configureServerCapacity({
        serverId: server.id,
        maxConcurrentBuilds: 2,
        maxQueuedDeployments: 5
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      admin.configureServerCapacity({
        serverId: server.id,
        maxConcurrentBuilds: 0,
        maxQueuedDeployments: 5
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const updated = await admin.configureServerCapacity({
      serverId: server.id,
      maxConcurrentBuilds: 2,
      maxQueuedDeployments: 5
    });

    expect(updated).toMatchObject({ maxConcurrentBuilds: 2, maxQueuedDeployments: 5 });

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.action, "server.capacity.configure"),
          eq(auditEntries.targetResource, `server/${server.id}`)
        )
      )
      .orderBy(desc(auditEntries.createdAt))
      .limit(1);

    expect(audit?.metadata).toMatchObject({
      previous: { maxConcurrentBuilds: 1, maxQueuedDeployments: 20 },
      next: { maxConcurrentBuilds: 2, maxQueuedDeployments: 5 }
    });
  });

  it("enforces capacity bounds in the service and database", async () => {
    const server = await createCapacityServer();

    await expect(
      configureServerCapacity({
        serverId: server.id,
        teamId: "team_foundation",
        maxConcurrentBuilds: 0,
        maxQueuedDeployments: 20,
        ...actor
      })
    ).rejects.toBeInstanceOf(ServerCapacityValidationError);

    await expect(
      db.update(servers).set({ maxQueuedDeployments: 0 }).where(eq(servers.id, server.id))
    ).rejects.toThrow();
  });

  it("rejects deployment creation when the target server queue is full", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));

    const first = await createDeploymentRecord(
      await createDeploymentInput(server.id, "queue-first")
    );
    expect(first?.id).toEqual(expect.any(String));

    await expect(
      createDeploymentRecord(await createDeploymentInput(server.id, "queue-second"))
    ).rejects.toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      serverId: server.id,
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });
  });

  it("keeps claimed deployments in queue occupancy while they wait for a build slot", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));
    const first = await createDeploymentRecord(
      await createDeploymentInput(server.id, "waiting-for-build-slot")
    );
    expect(first?.id).toEqual(expect.any(String));
    await db
      .update(deployments)
      .set({ status: "waiting" })
      .where(eq(deployments.id, first?.id ?? ""));

    const records = await listDeploymentRecords(undefined, 20, "team_foundation");
    expect(records.find((record) => record.id === first?.id)?.queueState).toEqual({
      reason: "build-slot",
      position: 1,
      activeBuilds: 0,
      maxConcurrentBuilds: 1
    });

    await expect(
      createDeploymentRecord(await createDeploymentInput(server.id, "blocked-by-build-wait"))
    ).rejects.toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      serverId: server.id,
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });
  });

  it("counts live reservations before admitting an unreserved deployment", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));
    const reservationId = `res-${nextFixtureSuffix()}`;

    await reserveDeploymentQueueSlot({
      reservationId,
      serverId: server.id,
      teamId: "team_foundation"
    });

    await expect(
      createDeploymentRecord(await createDeploymentInput(server.id, "blocked-by-reservation"))
    ).rejects.toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      serverId: server.id,
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });

    const reservations = await db
      .select({ id: deploymentQueueReservations.id })
      .from(deploymentQueueReservations)
      .where(eq(deploymentQueueReservations.serverId, server.id));
    expect(reservations).toEqual([{ id: reservationId }]);
  });

  it("does not reserve queue capacity across team boundaries", async () => {
    const server = await createCapacityServer();

    await expect(
      reserveDeploymentQueueSlot({
        reservationId: `res-cross-team-${nextFixtureSuffix()}`,
        serverId: server.id,
        teamId: "team_other"
      })
    ).rejects.toThrow(`Target server ${server.id} was not found.`);

    const reservations = await db
      .select({ id: deploymentQueueReservations.id })
      .from(deploymentQueueReservations)
      .where(eq(deploymentQueueReservations.serverId, server.id));
    expect(reservations).toEqual([]);
  });

  it("expires stale reservations before calculating queue capacity", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));
    const expiredReservationId = `res-expired-${nextFixtureSuffix()}`;
    const replacementReservationId = `res-live-${nextFixtureSuffix()}`;

    await reserveDeploymentQueueSlot({
      reservationId: expiredReservationId,
      serverId: server.id,
      teamId: "team_foundation",
      now: new Date(Date.now() - 60_000),
      ttlMs: 1
    });

    await reserveDeploymentQueueSlot({
      reservationId: replacementReservationId,
      serverId: server.id,
      teamId: "team_foundation"
    });

    const reservations = await db
      .select({ id: deploymentQueueReservations.id })
      .from(deploymentQueueReservations)
      .where(eq(deploymentQueueReservations.serverId, server.id));
    expect(reservations).toEqual([{ id: replacementReservationId }]);
  });

  it("atomically consumes a reservation when its deployment record is created", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));
    const reservationId = `res-consume-${nextFixtureSuffix()}`;
    const input = await createDeploymentInput(server.id, "reservation-consumed");

    await reserveDeploymentQueueSlot({
      reservationId,
      serverId: server.id,
      teamId: "team_foundation"
    });
    const deployment = await createDeploymentRecord({
      ...input,
      deploymentId: reservationId,
      queueReservationId: reservationId
    });

    expect(deployment?.id).toBe(reservationId);
    const reservations = await db
      .select({ id: deploymentQueueReservations.id })
      .from(deploymentQueueReservations)
      .where(eq(deploymentQueueReservations.id, reservationId));
    expect(reservations).toEqual([]);

    await expect(
      createDeploymentRecord(await createDeploymentInput(server.id, "queue-after-consume"))
    ).rejects.toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      queuedDeploymentCount: 1
    });
  });

  it("admits only one deployment when concurrent requests race for the last queue slot", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));
    const firstInput = await createDeploymentInput(server.id, "queue-race-first");
    const secondInput = await createDeploymentInput(server.id, "queue-race-second");

    const results = await Promise.allSettled([
      createDeploymentRecord(firstInput),
      createDeploymentRecord(secondInput)
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(rejected?.reason).toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      serverId: server.id,
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });
  });

  it("admits only one reservation when requests race for the last queue slot", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));

    const results = await Promise.allSettled([
      reserveDeploymentQueueSlot({
        reservationId: `res-race-a-${nextFixtureSuffix()}`,
        serverId: server.id,
        teamId: "team_foundation"
      }),
      reserveDeploymentQueueSlot({
        reservationId: `res-race-b-${nextFixtureSuffix()}`,
        serverId: server.id,
        teamId: "team_foundation"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(rejected?.reason).toMatchObject({
      code: DEPLOYMENT_QUEUE_FULL,
      serverId: server.id,
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });
  });

  it("maps queue-full failures to a stable conflict response", async () => {
    const caller = capacityErrorRouter.createCaller({
      requestId: "deployment-capacity-error-mapping",
      session: makeSession("owner")
    });

    await expect(caller.queueDeployment()).rejects.toMatchObject({
      code: "CONFLICT",
      cause: {
        code: DEPLOYMENT_QUEUE_FULL,
        serverId: "srv_capacity_full",
        maxQueuedDeployments: 20,
        queuedDeploymentCount: 20
      }
    });
  });

  it("restores queue capacity when a queued deployment is cancelled", async () => {
    const server = await createCapacityServer();
    await db.update(servers).set({ maxQueuedDeployments: 1 }).where(eq(servers.id, server.id));

    const first = await createDeploymentRecord(
      await createDeploymentInput(server.id, "cancelled-queue-entry")
    );
    expect(first?.id).toEqual(expect.any(String));

    const cancellation = await cancelDeployment({
      deploymentId: first?.id ?? "",
      teamId: "team_foundation",
      cancelledByUserId: actor.requestedByUserId,
      cancelledByEmail: actor.requestedByEmail,
      cancelledByRole: actor.requestedByRole
    });
    expect(cancellation.status).toBe("cancelled");

    const replacement = await createDeploymentRecord(
      await createDeploymentInput(server.id, "replacement-queue-entry")
    );
    expect(replacement?.id).toEqual(expect.any(String));
  });
});
