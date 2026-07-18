import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { servers } from "../db/schema/servers";
import { reserveDeploymentQueueSlot } from "../db/services/deployment-capacity";
import { appRouter } from "../router";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { createProjectEnvironmentServiceFixture } from "../testing/project-fixtures";
import { makeSession } from "../testing/request-auth-fixtures";

describe("managed database command capacity errors", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("returns the stable queue-full conflict through the public tRPC command", async () => {
    const fixture = await createProjectEnvironmentServiceFixture({
      project: {
        name: `Managed database command ${Date.now()}`,
        description: "Managed database command capacity fixture",
        teamId: "team_foundation"
      },
      environment: {
        name: "production",
        targetServerId: "srv_foundation_1"
      }
    });
    await db
      .update(servers)
      .set({ maxQueuedDeployments: 1 })
      .where(eq(servers.id, "srv_foundation_1"));
    await reserveDeploymentQueueSlot({
      reservationId: "res_managed_db_command_full",
      serverId: "srv_foundation_1",
      teamId: "team_foundation"
    });

    const caller = appRouter.createCaller({
      requestId: "managed-database-command-capacity",
      session: makeSession("owner")
    });

    await expect(
      caller.createManagedDatabase({
        kind: "postgres",
        projectId: fixture.project.id,
        environmentName: fixture.environment.name,
        serverId: "srv_foundation_1",
        name: "orders-database"
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      cause: {
        code: "DEPLOYMENT_QUEUE_FULL",
        serverId: "srv_foundation_1",
        maxQueuedDeployments: 1,
        queuedDeploymentCount: 1
      }
    });
  });
});
