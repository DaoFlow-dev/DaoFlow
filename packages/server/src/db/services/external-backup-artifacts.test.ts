import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTemporalEnabled: vi.fn(),
  startImport: vi.fn(),
  startRestore: vi.fn(),
  startVerification: vi.fn(),
  headObject: vi.fn(),
  listObjects: vi.fn()
}));

vi.mock("../../worker", () => ({
  buildExternalArtifactImportWorkflowId: (artifactId: string) =>
    `external-artifact-import-${artifactId}`,
  startExternalArtifactImportWorkflow: mocks.startImport,
  startExternalArtifactRestoreWorkflow: mocks.startRestore,
  startExternalArtifactVerificationWorkflow: mocks.startVerification
}));

vi.mock("../../worker/temporal/temporal-config", () => ({
  isTemporalEnabled: mocks.isTemporalEnabled
}));

vi.mock("../../worker/external-backup-s3", () => ({
  createExternalS3Adapter: () => ({
    headObject: mocks.headObject,
    listObjects: mocks.listObjects
  })
}));

import { db } from "../connection";
import { approvalRequests } from "../schema/audit";
import { backupDestinations } from "../schema/destinations";
import { externalBackupArtifacts } from "../schema/external-backup-artifacts";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  buildExternalRestoreApprovalSnapshot,
  listExternalBackupObjects,
  queueExternalArtifactRestore,
  registerExternalBackupArtifact,
  resolveExternalArtifactRestoreTarget,
  triggerExternalArtifactTestRestore
} from "./external-backup-artifacts";

const actor = {
  userId: "user_foundation_owner",
  email: "owner@daoflow.local",
  role: "owner" as const
};
const now = new Date("2026-07-19T00:00:00.000Z");
const destinationId = "dest_external_artifact";
const projectId = "proj_external_artifact";
const environmentId = "env_external_artifact";
const serviceId = "svc_external_artifact";
const volumeId = "vol_external_artifact";
const artifactId = "xart_external_artifact";

async function createFixture() {
  await db.insert(backupDestinations).values({
    id: destinationId,
    teamId: "team_foundation",
    name: "External S3",
    provider: "s3",
    bucket: "external-backups",
    encryptionMode: "none",
    externalImportEnabled: true,
    externalImportPrefix: "approved/postgres/",
    maxExternalImportBytes: "2147483648",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(projects).values({
    id: projectId,
    name: "External artifact target",
    slug: projectId,
    teamId: "team_foundation",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(environments).values({
    id: environmentId,
    name: "Production",
    slug: environmentId,
    projectId,
    config: {},
    createdAt: now,
    updatedAt: now
  });
  await db.insert(services).values({
    id: serviceId,
    name: "managed-postgres-service",
    slug: serviceId,
    projectId,
    environmentId,
    targetServerId: "srv_foundation_1",
    config: {
      managedDatabase: {
        kind: "postgres",
        label: "PostgreSQL",
        templateSlug: "postgres",
        databaseName: "appdb",
        username: "appuser",
        port: "5432",
        internalPort: "5432",
        serviceName: "managed-postgres-runtime",
        volumeName: "postgres-data",
        volumeId,
        backupPolicyId: null,
        backupType: "database",
        backupEngine: "postgres",
        connectionUriMasked: "postgres://appuser:[redacted]@host/appdb",
        internalConnectionUriMasked: "postgres://appuser:[redacted]@host/appdb",
        managedBy: "daoflow",
        createdFrom: "managed-database"
      }
    },
    createdAt: now,
    updatedAt: now
  });
  await db.insert(volumes).values({
    id: volumeId,
    name: "postgres-data",
    serverId: "srv_foundation_1",
    mountPath: "/var/lib/postgresql/data",
    metadata: { serviceId, projectId },
    createdAt: now,
    updatedAt: now
  });
  await db.insert(externalBackupArtifacts).values({
    id: artifactId,
    teamId: "team_foundation",
    destinationId,
    objectKey: "approved/postgres/app.dump",
    objectVersion: null,
    objectEtag: '"etag-only"',
    sizeBytes: "3",
    sha256: "a".repeat(64),
    archiveFormat: "postgres-custom",
    listingEvidence:
      "; Format: Custom\n; Dumped from database version: 16.4\n1; 1 1 SCHEMA - public postgres",
    sourcePostgresVersion: "16.4",
    verifierImage: `postgres:16@sha256:${"b".repeat(64)}`,
    status: "verified",
    registeredByUserId: actor.userId,
    registeredAt: now,
    verifiedAt: now,
    createdAt: now,
    updatedAt: now
  });
}

describe("external backup artifact persistence and approvals", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    mocks.isTemporalEnabled.mockReset();
    mocks.isTemporalEnabled.mockReturnValue(true);
    mocks.startImport.mockReset();
    mocks.startImport.mockResolvedValue({ workflowId: "external-import", runId: "run-import" });
    mocks.startRestore.mockReset();
    mocks.startRestore.mockResolvedValue({ workflowId: "external-restore", runId: "run-restore" });
    mocks.startVerification.mockReset();
    mocks.startVerification.mockResolvedValue({
      workflowId: "external-verify",
      runId: "run-verify"
    });
    mocks.headObject.mockReset();
    mocks.listObjects.mockReset();
  });

  it("returns the documented destination and verification response shapes", async () => {
    await createFixture();
    mocks.listObjects.mockResolvedValue({
      prefix: "approved/postgres/",
      objects: [
        {
          key: "approved/postgres/app.dump",
          name: "app.dump",
          size: 3,
          lastModified: null,
          etag: '"etag-only"',
          versionId: null
        }
      ]
    });

    await expect(
      listExternalBackupObjects({
        destinationId,
        teamId: "team_foundation",
        actor
      })
    ).resolves.toMatchObject({
      destination: {
        id: destinationId,
        name: "External S3",
        provider: "s3",
        externalImportEnabled: true,
        externalImportPrefix: "approved/postgres/",
        maxExternalImportBytes: 2147483648
      }
    });

    await db
      .update(externalBackupArtifacts)
      .set({ status: "registered", verifiedAt: null })
      .where(eq(externalBackupArtifacts.id, artifactId));
    await expect(
      triggerExternalArtifactTestRestore({ artifactId, teamId: "team_foundation", actor })
    ).resolves.toEqual({ id: expect.any(String), artifactId, status: "queued" });
  });

  it("atomically allows only one isolated verification request", async () => {
    await createFixture();
    await db
      .update(externalBackupArtifacts)
      .set({ status: "registered", verifiedAt: null })
      .where(eq(externalBackupArtifacts.id, artifactId));

    const results = await Promise.allSettled([
      triggerExternalArtifactTestRestore({ artifactId, teamId: "team_foundation", actor }),
      triggerExternalArtifactTestRestore({ artifactId, teamId: "team_foundation", actor })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(mocks.startVerification).toHaveBeenCalledTimes(1);
    const restores = await db.select().from(backupRestores);
    expect(restores.filter((restore) => restore.externalArtifactId === artifactId)).toHaveLength(1);
  });

  it("resolves a managed PostgreSQL target from service configuration and scopes it to the team", async () => {
    await createFixture();
    const target = await resolveExternalArtifactRestoreTarget({
      artifactId,
      targetVolumeId: volumeId,
      teamId: "team_foundation"
    });
    expect(target).toMatchObject({
      databaseName: "appdb",
      databaseUser: "appuser",
      runtimeServiceName: "managed-postgres-runtime",
      targetServiceId: serviceId
    });
    await expect(
      resolveExternalArtifactRestoreTarget({
        artifactId,
        targetVolumeId: volumeId,
        teamId: "team_other"
      })
    ).resolves.toBeNull();
  });

  it("accepts ETag-only approval snapshots and invalidates them when the managed runtime changes", async () => {
    await createFixture();
    const target = await resolveExternalArtifactRestoreTarget({
      artifactId,
      targetVolumeId: volumeId,
      teamId: "team_foundation"
    });
    if (!target) throw new Error("Expected managed target.");
    const snapshot = buildExternalRestoreApprovalSnapshot(target);
    expect(snapshot.artifactObjectVersion).toBe("");
    expect(snapshot.artifactObjectEtag).toBe('"etag-only"');
    await db.insert(approvalRequests).values({
      id: "apr_external_artifact",
      teamId: "team_foundation",
      actionType: "external-artifact-restore",
      targetResource: `external-backup-artifact/${artifactId}`,
      status: "approved",
      requestedByUserId: actor.userId,
      requestedByEmail: actor.email,
      requestedByRole: actor.role,
      resolvedByUserId: actor.userId,
      resolvedByEmail: actor.email,
      createdAt: now,
      resolvedAt: now
    });
    await expect(
      queueExternalArtifactRestore({
        artifactId,
        targetVolumeId: volumeId,
        teamId: "team_foundation",
        actor,
        approvalRequestId: "apr_external_artifact",
        approvalDispatchId: "apd_external_artifact",
        operationId: "brest_external_artifact",
        approvalSnapshot: { ...snapshot },
        preserveDispatchRetry: true
      })
    ).resolves.toMatchObject({ id: "brest_external_artifact", status: "queued" });
    expect(mocks.startRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        targetVolumeId: volumeId,
        approval: expect.objectContaining({ snapshot })
      })
    );

    await db
      .update(services)
      .set({ updatedAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(services.id, serviceId));
    await expect(
      queueExternalArtifactRestore({
        artifactId,
        targetVolumeId: volumeId,
        teamId: "team_foundation",
        actor,
        approvalRequestId: "apr_external_artifact",
        approvalDispatchId: "apd_external_artifact_2",
        operationId: "brest_external_artifact_2",
        approvalSnapshot: { ...snapshot },
        preserveDispatchRetry: true
      })
    ).resolves.toBeNull();
  });

  it("keeps legacy backup-run restores valid and rejects malformed external source/target combinations", async () => {
    await createFixture();
    await db.insert(backupPolicies).values({
      id: "bpol_external_legacy",
      name: "Legacy policy",
      volumeId,
      backupType: "database",
      databaseEngine: "postgres",
      retentionDays: 7,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    await db.insert(backupRuns).values({
      id: "brun_external_legacy",
      policyId: "bpol_external_legacy",
      status: "succeeded",
      artifactPath: "legacy.dump",
      createdAt: now
    });
    await expect(
      db.insert(backupRestores).values({
        id: "brest_external_legacy",
        backupRunId: "brun_external_legacy",
        externalArtifactId: null,
        targetVolumeId: null,
        mode: "restore",
        status: "queued",
        createdAt: now
      })
    ).resolves.toBeDefined();
    await expect(
      db.insert(backupRestores).values({
        id: "brest_external_invalid",
        backupRunId: null,
        externalArtifactId: artifactId,
        targetVolumeId: null,
        mode: "restore",
        status: "queued",
        createdAt: now
      })
    ).rejects.toThrow();
    await db
      .update(externalBackupArtifacts)
      .set({ status: "registered", verifiedAt: null })
      .where(eq(externalBackupArtifacts.id, artifactId));
    await expect(
      triggerExternalArtifactTestRestore({ artifactId, teamId: "team_foundation", actor })
    ).resolves.toMatchObject({ status: "queued" });
  });

  it("retries the same failed pinned identity without creating a duplicate artifact", async () => {
    await createFixture();
    await db
      .update(externalBackupArtifacts)
      .set({
        status: "failed",
        sha256: null,
        listingEvidence: null,
        verifierImage: null,
        registeredAt: null
      })
      .where(eq(externalBackupArtifacts.id, artifactId));
    mocks.headObject.mockResolvedValue({
      key: "approved/postgres/app.dump",
      versionId: null,
      etag: '"etag-only"',
      size: 3,
      contentType: null,
      lastModified: null
    });
    await expect(
      registerExternalBackupArtifact({
        destinationId,
        objectKey: "approved/postgres/app.dump",
        postgresMajor: "16",
        teamId: "team_foundation",
        actor
      })
    ).resolves.toMatchObject({ nextAction: "test-restore", workflowId: "external-import" });
    const rows = await db.select().from(externalBackupArtifacts);
    expect(rows.filter((row) => row.objectKey === "approved/postgres/app.dump")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: artifactId, status: "registering", registerError: null });
    expect(mocks.startImport).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId, destinationUpdatedAt: now.toISOString() })
    );
  });
});
