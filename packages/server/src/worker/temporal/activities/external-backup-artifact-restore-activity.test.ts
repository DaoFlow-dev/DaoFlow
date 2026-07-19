import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  download: vi.fn(),
  executeDatabaseRestore: vi.fn(),
  loadContext: vi.fn(),
  removeWorkspace: vi.fn(),
  resolveMemberRole: vi.fn(),
  resolveMetadata: vi.fn(),
  resolveRuntime: vi.fn(),
  resolveVolumeTeam: vi.fn(),
  updatedValues: [] as Record<string, unknown>[],
  withPreparedTarget: vi.fn()
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((...values: unknown[]) => values)
}));

vi.mock("../../../db/connection", () => ({
  db: { select: mocks.dbSelect, update: mocks.dbUpdate }
}));

vi.mock("../../../db/schema/audit", () => ({ approvalRequests: {} }));
vi.mock("../../../db/schema/storage", () => ({ backupRestores: {}, volumes: {} }));
vi.mock("../../../db/services/backup-resource-team", () => ({
  resolveVolumeTeamId: mocks.resolveVolumeTeam
}));
vi.mock("../../../db/services/external-backup-artifact-audit", () => ({
  writeExternalBackupArtifactAudit: mocks.audit
}));
vi.mock("../../../db/services/external-backup-artifact-read", () => ({
  resolveExternalPostgresRestoreRuntime: mocks.resolveRuntime,
  resolveExternalPostgresTargetMetadata: mocks.resolveMetadata
}));
vi.mock("../../../db/services/teams", () => ({
  resolveMemberRoleForTeam: mocks.resolveMemberRole
}));
vi.mock("../../execution-target", () => ({
  withPreparedExecutionTarget: mocks.withPreparedTarget
}));
vi.mock("./external-backup-artifact-activity-shared", () => ({
  downloadExternalArtifact: mocks.download,
  loadExternalArtifactContext: mocks.loadContext,
  temporalExternalArtifactHooks: () => ({})
}));
vi.mock("./external-backup-artifact-runtime", () => ({
  createExternalArtifactWorkspace: () => "/tmp/external-restore",
  removeExternalArtifactWorkspace: mocks.removeWorkspace,
  safeExternalArtifactError: (error: unknown) =>
    error instanceof Error ? error.message : String(error)
}));
vi.mock("./restore-database", () => ({ executeDatabaseRestore: mocks.executeDatabaseRestore }));

import { executeExternalArtifactRestore } from "./external-backup-artifact-restore-activity";

const updatedAt = new Date("2026-07-19T00:00:00.000Z");
const metadata = {
  databaseName: "app",
  databaseUser: "app_user",
  runtimeServiceName: "postgres",
  targetServiceId: "svc_postgres",
  targetServiceUpdatedAt: updatedAt.toISOString(),
  runtimeBinding: { kind: "service" as const, serviceId: "svc_postgres" }
};
const volume = {
  id: "vol_postgres",
  name: "postgres-data",
  serverId: "srv_production",
  mountPath: "/var/lib/postgresql/data",
  metadata: { databasePassword: "not-logged" },
  updatedAt
};
const context = {
  artifact: {
    id: "xart_postgres",
    teamId: "team_foundation",
    destinationId: "dest_external",
    objectKey: "approved/postgres/app.dump",
    objectVersion: "version-1",
    objectEtag: "etag-1",
    sha256: "a".repeat(64),
    status: "verified",
    verifiedAt: updatedAt
  },
  destination: { id: "dest_external", updatedAt }
};

function rows(values: unknown[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(values) }) }) };
}

describe("external artifact production restore finalization", () => {
  beforeEach(() => {
    mocks.audit.mockReset();
    mocks.dbSelect.mockReset();
    mocks.dbUpdate.mockReset();
    mocks.download.mockReset();
    mocks.executeDatabaseRestore.mockReset();
    mocks.loadContext.mockReset();
    mocks.removeWorkspace.mockReset();
    mocks.resolveMemberRole.mockReset();
    mocks.resolveMetadata.mockReset();
    mocks.resolveRuntime.mockReset();
    mocks.resolveVolumeTeam.mockReset();
    mocks.updatedValues.splice(0);
    mocks.withPreparedTarget.mockReset();
    mocks.dbUpdate.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return { where: () => Promise.resolve() };
      }
    }));
    mocks.dbSelect
      .mockImplementationOnce(() => rows([volume]))
      .mockImplementationOnce(() => rows([{ resolvedByUserId: "user_owner" }]))
      .mockImplementationOnce(() => rows([{ resolvedByUserId: "user_owner" }]));
    mocks.loadContext.mockResolvedValue(context);
    mocks.resolveVolumeTeam.mockResolvedValue("team_foundation");
    mocks.resolveMemberRole.mockResolvedValue("owner");
    mocks.resolveMetadata.mockResolvedValue(metadata);
    mocks.download.mockResolvedValue({
      path: "/tmp/external-restore/app.dump",
      sha256: "a".repeat(64)
    });
    mocks.resolveRuntime.mockResolvedValue({
      ...metadata,
      target: { mode: "local" },
      runtime: { kind: "container", containerName: "project-postgres-1" }
    });
    mocks.withPreparedTarget.mockImplementation(
      async (target: unknown, run: (prepared: unknown) => Promise<unknown>) => run(target)
    );
    mocks.executeDatabaseRestore.mockResolvedValue({ success: true, bytesRestored: 3 });
    mocks.removeWorkspace.mockReturnValue("Temporary artifact workspace could not be removed.");
    mocks.audit.mockRejectedValue(new Error("audit storage unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("keeps a completed restore successful when audit and cleanup reporting fail", async () => {
    const approval = {
      approvalRequestId: "apr_restore",
      expectedTeamId: "team_foundation",
      snapshot: {
        artifactId: context.artifact.id,
        artifactSha256: context.artifact.sha256,
        artifactObjectKey: context.artifact.objectKey,
        artifactObjectVersion: context.artifact.objectVersion,
        artifactObjectEtag: context.artifact.objectEtag,
        artifactVerifiedAt: updatedAt.toISOString(),
        destinationId: context.destination.id,
        destinationUpdatedAt: updatedAt.toISOString(),
        targetVolumeId: volume.id,
        targetVolumeUpdatedAt: updatedAt.toISOString(),
        targetServerId: volume.serverId,
        targetMountPath: volume.mountPath,
        targetServiceId: metadata.targetServiceId,
        targetServiceUpdatedAt: metadata.targetServiceUpdatedAt,
        runtimeServiceName: metadata.runtimeServiceName,
        databaseEngine: "postgres" as const,
        databaseName: metadata.databaseName,
        databaseUser: metadata.databaseUser,
        secretPolicy: "destination-credentials-encrypted" as const
      }
    };

    await expect(
      executeExternalArtifactRestore({
        artifactId: context.artifact.id,
        restoreId: "brest_postgres",
        targetVolumeId: volume.id,
        approval
      })
    ).resolves.toBeUndefined();

    expect(mocks.executeDatabaseRestore).toHaveBeenCalledTimes(1);
    expect(mocks.executeDatabaseRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTarget: { mode: "local" },
        runtime: { kind: "container", containerName: "project-postgres-1" }
      }),
      "/tmp/external-restore/app.dump",
      {}
    );
    expect(mocks.updatedValues.map((value) => value.status)).toEqual(["running", "succeeded"]);
    expect(mocks.removeWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "external-artifact.restore.cleanup-failed",
        outcome: "failure"
      })
    );
  });
});
