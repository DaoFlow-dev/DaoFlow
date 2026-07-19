import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { gitProviders } from "../schema/git-providers";
import { providerFeedback, providerFeedbackTargets } from "../schema/provider-feedback";
import { projects } from "../schema/projects";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  DeploymentTransitionRejectedError,
  requireDeploymentTransitionWithFeedback,
  transitionDeploymentWithFeedback
} from "./deployment-transition-feedback";
import { queueProviderFeedbackIntent } from "./provider-feedback-intents";
import {
  createGitProviderFixture,
  createProviderFeedbackFixture
} from "./provider-feedback-fixtures";

describe("provider feedback intents", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS provider_feedback_insert_failure ON provider_feedback`
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_provider_feedback_insert()`);
  });

  it("rolls back a deployment transition when the durable intent insert fails", async () => {
    const fixture = await createProviderFeedbackFixture();
    await db.execute(sql`
      CREATE FUNCTION fail_provider_feedback_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'provider feedback insert failed';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER provider_feedback_insert_failure
      BEFORE INSERT ON provider_feedback
      FOR EACH ROW EXECUTE FUNCTION fail_provider_feedback_insert()
    `);

    await expect(
      transitionDeploymentWithFeedback({
        deploymentId: fixture.deploymentId,
        status: "prepare"
      })
    ).rejects.toThrow();

    const [deployment] = await db
      .select({ status: deployments.status })
      .from(deployments)
      .where(eq(deployments.id, fixture.deploymentId));
    const feedback = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(deployment?.status).toBe("queued");
    expect(feedback).toEqual([]);
  });

  it("creates only one feedback row for repeated transition attempts", async () => {
    const fixture = await createProviderFeedbackFixture();

    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "prepare"
    });
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "prepare"
    });

    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));
    expect(rows.filter((row) => row.transition === "prepare")).toHaveLength(1);
  });

  it("keeps a deployment's first provider target and records terminal feedback after provider removal", async () => {
    const fixture = await createProviderFeedbackFixture();
    await db.transaction((tx) =>
      queueProviderFeedbackIntent(tx, {
        deploymentId: fixture.deploymentId,
        transition: "queued"
      })
    );

    const replacementProviderId = await createGitProviderFixture({ teamId: fixture.teamId });
    await db
      .update(projects)
      .set({
        gitProviderId: replacementProviderId,
        repoFullName: "other-owner/other-repository",
        updatedAt: new Date()
      })
      .where(eq(projects.id, fixture.projectId));
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "prepare"
    });

    await db
      .update(projects)
      .set({ gitProviderId: null, updatedAt: new Date() })
      .where(eq(projects.id, fixture.projectId));
    await db.delete(gitProviders).where(eq(gitProviders.id, fixture.providerId));
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });

    const targets = await db
      .select()
      .from(providerFeedbackTargets)
      .where(eq(providerFeedbackTargets.deploymentId, fixture.deploymentId));
    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));

    expect(targets).toHaveLength(1);
    expect(targets[0]?.providerId).toBe(fixture.providerId);
    expect(
      (targets[0]?.context as { repository?: { fullName?: string } }).repository?.fullName
    ).toBe("daoflow/example-service");
    expect(targets[0]?.context).not.toHaveProperty("repository.url");
    expect(targets[0]?.context).not.toHaveProperty("preview.primaryDomain");
    expect(rows.map((row) => row.providerId)).toEqual(
      expect.arrayContaining([fixture.providerId, fixture.providerId, fixture.providerId])
    );
    expect(rows.map((row) => row.transition)).toEqual(
      expect.arrayContaining(["queued", "prepare", "completed"])
    );
  });

  it("does not let a stale writer replace a terminal deployment result", async () => {
    const fixture = await createProviderFeedbackFixture();
    await transitionDeploymentWithFeedback({
      deploymentId: fixture.deploymentId,
      status: "completed",
      conclusion: "succeeded"
    });
    await expect(
      transitionDeploymentWithFeedback({
        deploymentId: fixture.deploymentId,
        status: "failed",
        conclusion: "failed"
      })
    ).resolves.toBeNull();
    await expect(
      requireDeploymentTransitionWithFeedback({
        deploymentId: fixture.deploymentId,
        status: "failed",
        conclusion: "failed"
      })
    ).rejects.toBeInstanceOf(DeploymentTransitionRejectedError);

    const [deployment] = await db
      .select({ status: deployments.status, conclusion: deployments.conclusion })
      .from(deployments)
      .where(eq(deployments.id, fixture.deploymentId));
    const rows = await db
      .select()
      .from(providerFeedback)
      .where(eq(providerFeedback.deploymentId, fixture.deploymentId));

    expect(deployment).toEqual({ status: "completed", conclusion: "succeeded" });
    expect(rows.map((row) => row.transition)).toEqual(["completed"]);
  });
});
