import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { createDeploymentRecord } from "./deployments";
import { executeRollback, listRollbackTargets } from "./execute-rollback";
import { loadComposePreviewHistoryForServiceId } from "./compose-previews";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

let fixtureCounter = 0;

async function createServiceLinkFixture() {
  fixtureCounter += 1;
  const suffix = `${Date.now()}-${fixtureCounter}`;
  const projectResult = await createProject({
    name: `Service link ${suffix}`,
    description: "Deployment service linkage fixture",
    teamId: "team_foundation",
    ...actor
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create service link project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `service-link-${suffix}`,
    targetServerId: "srv_foundation_1",
    ...actor
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create service link environment fixture.");
  }

  const serviceResult = await createService({
    name: "api",
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: "srv_foundation_1",
    ...actor
  });
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create service link service fixture.");
  }

  return {
    project: projectResult.project,
    environment: environmentResult.environment,
    service: serviceResult.service
  };
}

function deploymentInput(
  fixture: Awaited<ReturnType<typeof createServiceLinkFixture>>,
  deploymentId: string
) {
  return {
    deploymentId,
    serviceId: fixture.service.id,
    projectName: fixture.project.name,
    environmentName: fixture.environment.name,
    serviceName: fixture.service.name,
    sourceType: "compose" as const,
    targetServerId: "srv_foundation_1",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    imageTag: "ghcr.io/daoflow/api:test",
    teamId: "team_foundation",
    ...actor,
    steps: [{ label: "Queued", detail: "Added to the deployment queue." }]
  };
}

describe("deployment service linkage", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("stores the one matching service and rejects a source-type mismatch", async () => {
    const fixture = await createServiceLinkFixture();
    const input = deploymentInput(fixture, `dep_service_link_${fixtureCounter}`);

    await expect(createDeploymentRecord(input)).resolves.toMatchObject({ id: input.deploymentId });

    const [stored] = await db
      .select({ serviceId: deployments.serviceId })
      .from(deployments)
      .where(eq(deployments.id, input.deploymentId));
    expect(stored?.serviceId).toBe(fixture.service.id);

    await expect(
      createDeploymentRecord({
        ...input,
        deploymentId: `dep_service_link_mismatch_${fixtureCounter}`,
        sourceType: "image"
      })
    ).resolves.toBeNull();
  });

  it("replays the existing deployment without rebinding after a service replacement", async () => {
    const fixture = await createServiceLinkFixture();
    const input = deploymentInput(fixture, `dep_service_replay_${fixtureCounter}`);

    await createDeploymentRecord(input);
    await db.delete(services).where(eq(services.id, fixture.service.id));

    const replacement = await createService({
      name: fixture.service.name,
      projectId: fixture.project.id,
      environmentId: fixture.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      ...actor
    });
    expect(replacement.status).toBe("ok");
    if (replacement.status !== "ok") {
      throw new Error("Failed to create replacement service fixture.");
    }

    await expect(createDeploymentRecord(input)).resolves.toMatchObject({ id: input.deploymentId });

    const [stored] = await db
      .select({ serviceId: deployments.serviceId })
      .from(deployments)
      .where(eq(deployments.id, input.deploymentId));
    expect(stored?.serviceId).toBe(fixture.service.id);
    expect(stored?.serviceId).not.toBe(replacement.service.id);

    await expect(
      createDeploymentRecord({
        ...input,
        deploymentId: `dep_service_rebind_${fixtureCounter}`
      })
    ).resolves.toBeNull();
  });

  it("does not expose an old service deployment through a same-name replacement", async () => {
    const fixture = await createServiceLinkFixture();
    const input = deploymentInput(fixture, `dep_service_history_${fixtureCounter}`);
    const deployment = await createDeploymentRecord(input);
    if (!deployment) {
      throw new Error("Failed to create service history deployment fixture.");
    }

    await db
      .update(deployments)
      .set({
        status: "completed",
        conclusion: "succeeded",
        configSnapshot: {
          preview: {
            target: "branch",
            action: "deploy",
            key: "branch-main",
            branch: "main",
            pullRequestNumber: null,
            envBranch: "preview/main",
            stackName: "service-history-preview",
            primaryDomain: null
          }
        }
      })
      .where(eq(deployments.id, deployment.id));

    await db.delete(services).where(eq(services.id, fixture.service.id));
    const replacement = await createService({
      name: fixture.service.name,
      projectId: fixture.project.id,
      environmentId: fixture.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      ...actor
    });
    expect(replacement.status).toBe("ok");
    if (replacement.status !== "ok") {
      throw new Error("Failed to create service history replacement fixture.");
    }

    await expect(
      listRollbackTargets(replacement.service.id, actor.requestedByUserId)
    ).resolves.toEqual([]);
    await expect(
      loadComposePreviewHistoryForServiceId(replacement.service.id)
    ).resolves.toMatchObject({
      previews: []
    });
    await expect(
      executeRollback({
        serviceId: replacement.service.id,
        targetDeploymentId: deployment.id,
        ...actor
      })
    ).resolves.toEqual({ status: "not_found", entity: "deployment" });
  });
});
