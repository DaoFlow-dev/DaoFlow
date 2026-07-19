import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../connection";
import { deployments } from "../schema/deployments";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

describe("deployment service link migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("fails closed instead of binding history to a same-name replacement service", async () => {
    const suffix = Date.now().toString();
    const projectResult = await createProject({
      name: `Migration replacement ${suffix}`,
      description: "Deployment service link migration fixture",
      teamId: "team_foundation",
      ...actor
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create migration replacement project fixture.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `migration-replacement-${suffix}`,
      targetServerId: "srv_foundation_1",
      ...actor
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create migration replacement environment fixture.");
    }

    const deploymentId = `dep_migration_replacement_${suffix}`.slice(0, 32);
    await db.insert(deployments).values({
      id: deploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceId: "svc_deleted_before_migration",
      serviceName: "api",
      sourceType: "compose",
      configSnapshot: {},
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      ...actor,
      createdAt: new Date(Date.now() - 120_000),
      updatedAt: new Date(Date.now() - 119_000)
    });

    const replacement = await createService({
      name: "api",
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      ...actor
    });
    expect(replacement.status).toBe("ok");

    const migration = await readFile(
      fileURLToPath(
        new URL("../../../../../drizzle/0042_backfill_deployment_service_link.sql", import.meta.url)
      ),
      "utf8"
    );

    await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" DROP NOT NULL');
    await pool.query('UPDATE "deployments" SET "service_id" = NULL WHERE "id" = $1', [
      deploymentId
    ]);

    try {
      await expect(pool.query(migration)).rejects.toThrow(/predate their matching service/);
    } finally {
      await pool.query('DELETE FROM "deployments" WHERE "id" = $1', [deploymentId]);
      await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" SET NOT NULL');
    }
  });
});
