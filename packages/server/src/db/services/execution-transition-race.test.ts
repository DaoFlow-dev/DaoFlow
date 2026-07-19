import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments } from "../schema/deployments";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { completeExecutionJob } from "./execution";
import { createProviderFeedbackFixture } from "./provider-feedback-fixtures";

describe("execution transition races", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(async () => {
    await db.execute(sql`DROP TRIGGER IF EXISTS reject_execution_transition ON deployments`);
    await db.execute(sql`DROP FUNCTION IF EXISTS reject_execution_transition()`);
  });

  it("does not report success when a concurrent terminal transition wins", async () => {
    const fixture = await createProviderFeedbackFixture();
    await db
      .update(deployments)
      .set({ serviceName: "provider-feedback-execution-race" })
      .where(eq(deployments.id, fixture.deploymentId));
    await db.execute(sql`
      CREATE FUNCTION reject_execution_transition() RETURNS trigger AS $$
      BEGIN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER reject_execution_transition
      BEFORE UPDATE ON deployments
      FOR EACH ROW
      WHEN (
        OLD.service_name = 'provider-feedback-execution-race'
        AND NEW.status = 'completed'
      )
      EXECUTE FUNCTION reject_execution_transition()
    `);

    await expect(
      completeExecutionJob(
        fixture.deploymentId,
        "user_foundation_owner",
        "owner@daoflow.local",
        "owner",
        fixture.teamId
      )
    ).resolves.toEqual({ status: "invalid-state", currentStatus: "queued" });

    const [deployment] = await db
      .select({ status: deployments.status })
      .from(deployments)
      .where(eq(deployments.id, fixture.deploymentId));
    const audit = await db
      .select({ id: auditEntries.id })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `execution-job/${fixture.deploymentId}`),
          eq(auditEntries.action, "execution.complete")
        )
      );
    const successEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(eq(events.resourceId, fixture.deploymentId), eq(events.kind, "deployment.succeeded"))
      );
    const logs = await db
      .select({ id: deploymentLogs.id })
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, fixture.deploymentId));

    expect(deployment?.status).toBe("queued");
    expect(audit).toEqual([]);
    expect(successEvents).toEqual([]);
    expect(logs).toEqual([]);
  });
});
