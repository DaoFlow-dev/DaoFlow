import { beforeEach, describe, expect, it } from "vitest";
import { createManagedDatabase, listManagedDatabases } from "./managed-databases";
import { db } from "../connection";
import { backupPolicies, volumes } from "../schema/storage";
import { deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { eq } from "drizzle-orm";
import { reserveDeploymentQueueSlot } from "./deployment-capacity";
import {
  createProjectEnvironmentServiceFixture,
  foundationOwnerRequester
} from "../../testing/project-fixtures";
import { resetTestDatabaseWithControlPlane } from "../../test-db";

describe("managed database services", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("creates a compose-backed database service with masked connection details", async () => {
    const fixture = await createProjectEnvironmentServiceFixture({
      project: {
        name: `Managed DB ${Date.now()}`,
        description: "Managed database test project",
        teamId: "team_foundation"
      },
      environment: {
        name: "production",
        targetServerId: "srv_foundation_1"
      }
    });

    const result = await createManagedDatabase({
      kind: "mysql",
      projectId: fixture.project.id,
      environmentName: fixture.environment.name,
      serverId: "srv_foundation_1",
      teamId: "team_foundation",
      name: "orders-db",
      databaseName: "orders",
      username: "orders",
      password: "app-secret",
      rootPassword: "root-secret",
      port: "3307",
      ...foundationOwnerRequester
    });

    if (result.status !== "ok") {
      throw new Error(`Expected managed database creation to succeed, got ${result.status}`);
    }

    expect(result.managedDatabase).toMatchObject({
      kind: "mysql",
      label: "MySQL",
      databaseName: "orders",
      username: "orders",
      port: "3307",
      backupType: "database",
      backupEngine: "mysql",
      connectionUriMasked: "mysql://orders:[secret]@localhost:3307/orders"
    });
    expect(result.volume.serviceId).toBe(result.service.id);
    expect(result.backupPolicy.backupType).toBe("database");
    expect(result.backupPolicy.databaseEngine).toBe("mysql");
    expect(JSON.stringify(result.service.config)).not.toContain("app-secret");
    expect(JSON.stringify(result.deployment.configSnapshot)).not.toContain("root-secret");

    const [volume] = await db
      .select()
      .from(volumes)
      .where(eq(volumes.id, result.managedDatabase.volumeId ?? ""));
    const [policy] = await db
      .select()
      .from(backupPolicies)
      .where(eq(backupPolicies.id, result.managedDatabase.backupPolicyId ?? ""));
    expect(volume?.mountPath).toBe("/var/lib/mysql");
    expect(policy?.databaseEngine).toBe("mysql");

    const rows = await listManagedDatabases({ teamId: "team_foundation" });
    const created = rows.find((row) => row.serviceId === result.service.id);
    expect(created?.database?.connectionUriMasked).toBe(
      "mysql://orders:[secret]@localhost:3307/orders"
    );
  });

  it("rejects a full queue before creating managed database artifacts or resources", async () => {
    const fixture = await createProjectEnvironmentServiceFixture({
      project: {
        name: `Managed DB queue ${Date.now()}`,
        description: "Managed database capacity test project",
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
      reservationId: "res_managed_db_full",
      serverId: "srv_foundation_1",
      teamId: "team_foundation"
    });

    const [servicesBefore, volumesBefore, policiesBefore, deploymentsBefore] = await Promise.all([
      db.select({ id: services.id }).from(services),
      db.select({ id: volumes.id }).from(volumes),
      db.select({ id: backupPolicies.id }).from(backupPolicies),
      db.select({ id: deployments.id }).from(deployments)
    ]);

    await expect(
      createManagedDatabase({
        kind: "mysql",
        projectId: fixture.project.id,
        environmentName: fixture.environment.name,
        serverId: "srv_foundation_1",
        teamId: "team_foundation",
        name: "orders-db-full",
        ...foundationOwnerRequester
      })
    ).rejects.toMatchObject({
      code: "DEPLOYMENT_QUEUE_FULL",
      serverId: "srv_foundation_1",
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });

    const [servicesAfter, volumesAfter, policiesAfter, deploymentsAfter] = await Promise.all([
      db.select({ id: services.id }).from(services),
      db.select({ id: volumes.id }).from(volumes),
      db.select({ id: backupPolicies.id }).from(backupPolicies),
      db.select({ id: deployments.id }).from(deployments)
    ]);

    expect(servicesAfter).toEqual(servicesBefore);
    expect(volumesAfter).toEqual(volumesBefore);
    expect(policiesAfter).toEqual(policiesBefore);
    expect(deploymentsAfter).toEqual(deploymentsBefore);
  });
});
