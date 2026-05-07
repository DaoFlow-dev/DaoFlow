import { beforeEach, describe, expect, it } from "vitest";
import { createManagedDatabase, listManagedDatabases } from "./managed-databases";
import { db } from "../connection";
import { backupPolicies, volumes } from "../schema/storage";
import { eq } from "drizzle-orm";
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
});
