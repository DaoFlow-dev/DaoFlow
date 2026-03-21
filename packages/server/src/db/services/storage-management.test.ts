import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelBackupCronWorkflowMock, startBackupCronWorkflowMock, isTemporalEnabledMock } =
  vi.hoisted(() => ({
    cancelBackupCronWorkflowMock: vi.fn(),
    startBackupCronWorkflowMock: vi.fn(),
    isTemporalEnabledMock: vi.fn()
  }));

vi.mock("../../worker", async () => {
  const actual = await vi.importActual<typeof import("../../worker")>("../../worker");
  return {
    ...actual,
    cancelBackupCronWorkflow: cancelBackupCronWorkflowMock,
    startBackupCronWorkflow: startBackupCronWorkflowMock
  };
});

vi.mock("../../worker/temporal/temporal-config", async () => {
  const actual = await vi.importActual<typeof import("../../worker/temporal/temporal-config")>(
    "../../worker/temporal/temporal-config"
  );
  return {
    ...actual,
    isTemporalEnabled: isTemporalEnabledMock
  };
});

import { db } from "../connection";
import { servers } from "../schema/servers";
import { backupPolicies, volumes } from "../schema/storage";
import { teams } from "../schema/teams";
import { users } from "../schema/users";
import { resetTestDatabase } from "../../test-db";
import { createDestination } from "./destinations";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";
import { asRecord } from "./json-helpers";
import {
  createBackupPolicy,
  createVolume,
  deleteBackupPolicy,
  deleteVolume
} from "./storage-management";

function suffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

const actor = {
  userId: "user_foundation_owner",
  email: "owner@daoflow.local",
  role: "owner" as const
};

async function ensureActorFixture() {
  const now = new Date();

  await db.insert(users).values({
    id: actor.userId,
    email: actor.email,
    name: "Fixture Owner",
    username: "fixture-owner",
    emailVerified: true,
    role: actor.role,
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  await db.insert(teams).values({
    id: "team_foundation",
    name: "Foundation Team",
    slug: "foundation-team",
    status: "active",
    createdByUserId: actor.userId,
    createdAt: now,
    updatedAt: now
  });
}

async function createServerFixture() {
  const id = `srvstor${suffix()}`;

  await db.insert(servers).values({
    id,
    name: `storage-${id}`,
    host: `${id}.test`,
    sshPort: 22,
    kind: "docker-engine",
    status: "ready",
    metadata: {},
    registeredByUserId: actor.userId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return id;
}

async function createServiceFixture(serverId: string) {
  const projectResult = await createProject({
    name: `Storage Project ${suffix()}`,
    description: "Storage management fixture",
    teamId: "team_foundation",
    requestedByUserId: actor.userId,
    requestedByEmail: actor.email,
    requestedByRole: actor.role
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `Fixture Env ${suffix()}`,
    targetServerId: serverId,
    requestedByUserId: actor.userId,
    requestedByEmail: actor.email,
    requestedByRole: actor.role
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create fixture environment.");
  }

  const serviceResult = await createService({
    name: `fixture-service-${suffix()}`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: serverId,
    requestedByUserId: actor.userId,
    requestedByEmail: actor.email,
    requestedByRole: actor.role
  });
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create fixture service.");
  }

  return {
    projectId: projectResult.project.id,
    projectName: projectResult.project.name,
    environmentId: environmentResult.environment.id,
    environmentName: environmentResult.environment.name,
    serviceId: serviceResult.service.id,
    serviceName: serviceResult.service.name
  };
}

describe("storage-management", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await ensureActorFixture();
    cancelBackupCronWorkflowMock.mockReset();
    startBackupCronWorkflowMock.mockReset();
    isTemporalEnabledMock.mockReset();
    isTemporalEnabledMock.mockReturnValue(true);
    startBackupCronWorkflowMock.mockResolvedValue({
      workflowId: "backup-cron-storage-test",
      runId: "temporal-run-storage-test"
    });
  });

  it("registers a volume with stable service and project metadata", async () => {
    const serverId = await createServerFixture();
    const service = await createServiceFixture(serverId);

    const result = await createVolume(
      {
        name: "postgres-data",
        serverId,
        mountPath: "/var/lib/postgresql/data",
        sizeBytes: 4096,
        driver: "local",
        serviceId: service.serviceId
      },
      actor
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    const [stored] = await db
      .select()
      .from(volumes)
      .where(eq(volumes.id, result.volume.id))
      .limit(1);

    const metadata = asRecord(stored?.metadata);
    expect(result.volume.serviceId).toBe(service.serviceId);
    expect(metadata.projectName).toBe(service.projectName);
    expect(metadata.environmentName).toBe(service.environmentName);
    expect(metadata.serviceName).toBe(service.serviceName);
    expect(metadata.backupCoverage).toBe("missing");
  });

  it("creates a backup policy, starts the schedule workflow, and marks the volume protected", async () => {
    const serverId = await createServerFixture();
    const volumeResult = await createVolume(
      {
        name: "redis-data",
        serverId,
        mountPath: "/data"
      },
      actor
    );
    if (volumeResult.status !== "ok") {
      throw new Error("Failed to create fixture volume.");
    }

    const destination = await createDestination(
      {
        name: "Primary Backups",
        provider: "local",
        localPath: "/tmp/daoflow-backups"
      },
      actor.userId,
      actor.email,
      actor.role
    );

    const result = await createBackupPolicy(
      {
        name: "redis-nightly",
        volumeId: volumeResult.volume.id,
        destinationId: destination.id,
        schedule: "0 3 * * *",
        retentionDays: 14
      },
      actor
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    expect(startBackupCronWorkflowMock).toHaveBeenCalledWith(result.policy.id, "0 3 * * *");

    const [storedVolume] = await db
      .select()
      .from(volumes)
      .where(eq(volumes.id, volumeResult.volume.id))
      .limit(1);
    const metadata = asRecord(storedVolume?.metadata);

    expect(result.policy.destinationId).toBe(destination.id);
    expect(result.policy.schedule).toBe("0 3 * * *");
    expect(metadata.backupPolicyId).toBe(result.policy.id);
    expect(metadata.backupCoverage).toBe("protected");
  });

  it("blocks volume deletion while a backup policy is still linked", async () => {
    const serverId = await createServerFixture();
    const volumeResult = await createVolume(
      {
        name: "blocked-volume",
        serverId,
        mountPath: "/srv/blocked"
      },
      actor
    );
    if (volumeResult.status !== "ok") {
      throw new Error("Failed to create fixture volume.");
    }

    await db.insert(backupPolicies).values({
      id: `bpolstor${suffix()}`,
      name: "blocked-policy",
      volumeId: volumeResult.volume.id,
      backupType: "volume",
      retentionDays: 30,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const result = await deleteVolume(volumeResult.volume.id, actor);

    expect(result).toMatchObject({
      status: "has-dependencies"
    });
  });

  it("clears volume protection metadata when a policy is deleted", async () => {
    const serverId = await createServerFixture();
    const volumeResult = await createVolume(
      {
        name: "temp-volume",
        serverId,
        mountPath: "/srv/temp"
      },
      actor
    );
    if (volumeResult.status !== "ok") {
      throw new Error("Failed to create fixture volume.");
    }

    const [policy] = await db
      .insert(backupPolicies)
      .values({
        id: `bpolstor${suffix()}`,
        name: "temporary-policy",
        volumeId: volumeResult.volume.id,
        backupType: "volume",
        retentionDays: 7,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning();

    await db
      .update(volumes)
      .set({
        metadata: {
          backupPolicyId: policy.id,
          backupCoverage: "protected",
          restoreReadiness: "untested"
        }
      })
      .where(eq(volumes.id, volumeResult.volume.id));

    const result = await deleteBackupPolicy(policy.id, actor);

    expect(result).toMatchObject({
      status: "ok",
      deleted: true
    });

    const [storedVolume] = await db
      .select()
      .from(volumes)
      .where(eq(volumes.id, volumeResult.volume.id))
      .limit(1);

    const metadata = asRecord(storedVolume?.metadata);
    expect(metadata.backupPolicyId).toBeNull();
    expect(metadata.backupCoverage).toBe("missing");
  });
});
