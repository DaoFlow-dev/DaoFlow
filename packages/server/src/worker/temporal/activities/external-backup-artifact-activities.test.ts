import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  resolveImage: vi.fn(),
  download: vi.fn()
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({ heartbeat: vi.fn(), cancellationSignal: new AbortController().signal })
  }
}));

vi.mock("../../external-backup-s3", () => ({
  createExternalS3Adapter: () => ({ downloadPinnedObject: mocks.download })
}));

vi.mock("./external-postgres-artifact", () => ({
  inspectExternalPostgresCustomArchive: mocks.inspect,
  resolveOfficialPostgresVerifierImage: mocks.resolveImage
}));

import { db } from "../../../db/connection";
import { backupDestinations } from "../../../db/schema/destinations";
import { externalBackupArtifacts } from "../../../db/schema/external-backup-artifacts";
import { resetTestDatabaseWithControlPlane } from "../../../test-db";
import { importExternalBackupArtifact } from "./external-backup-artifact-activities";
import { externalArtifactVerificationTestHooks } from "./external-backup-artifact-verification-activity";

const now = new Date("2026-07-19T00:00:00.000Z");
const destinationId = "dest_import_retry";
const artifactId = "xart_import_retry";

async function fixture() {
  await db.insert(backupDestinations).values({
    id: destinationId,
    teamId: "team_foundation",
    name: "External destination",
    provider: "s3",
    bucket: "backups",
    encryptionMode: "none",
    externalImportEnabled: true,
    externalImportPrefix: "approved/postgres/",
    maxExternalImportBytes: "2147483648",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(externalBackupArtifacts).values({
    id: artifactId,
    teamId: "team_foundation",
    destinationId,
    objectKey: "approved/postgres/app.dump",
    objectVersion: null,
    objectEtag: '"etag"',
    sizeBytes: "3",
    sourcePostgresVersion: "16",
    status: "registering",
    registeredByUserId: "user_foundation_owner",
    createdAt: now,
    updatedAt: now
  });
}

describe("external artifact import workflow activity", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    mocks.download.mockReset();
    mocks.download.mockResolvedValue({ sha256: "a".repeat(64), bytes: 3 });
    mocks.resolveImage.mockReset();
    mocks.resolveImage.mockResolvedValue(`postgres:16@sha256:${"b".repeat(64)}`);
    mocks.inspect.mockReset();
    mocks.inspect.mockResolvedValue({
      sourcePostgresVersion: "16.4",
      listingEvidence:
        "; Format: Custom\n; Dumped from database version: 16.4\n1; 1 1 SCHEMA - public postgres"
    });
  });

  it("records a failed import then retries the same artifact to a registered state", async () => {
    await fixture();
    mocks.inspect.mockRejectedValueOnce(new Error("transient archive inspector failure"));
    await expect(
      importExternalBackupArtifact({ artifactId, destinationUpdatedAt: now.toISOString() })
    ).rejects.toThrow("transient archive inspector failure");
    const [failed] = await db
      .select()
      .from(externalBackupArtifacts)
      .where(eq(externalBackupArtifacts.id, artifactId));
    expect(failed).toMatchObject({
      status: "failed",
      registerError: "transient archive inspector failure"
    });

    await expect(
      importExternalBackupArtifact({ artifactId, destinationUpdatedAt: now.toISOString() })
    ).resolves.toBeUndefined();
    const [registered] = await db
      .select()
      .from(externalBackupArtifacts)
      .where(eq(externalBackupArtifacts.id, artifactId));
    expect(registered).toMatchObject({ status: "registered", sha256: "a".repeat(64) });
  });

  it("persists destination revision mismatch as a durable import failure", async () => {
    await fixture();
    await expect(
      importExternalBackupArtifact({ artifactId, destinationUpdatedAt: "2026-07-18T00:00:00.000Z" })
    ).rejects.toThrow("destination changed");
    const [artifact] = await db
      .select()
      .from(externalBackupArtifacts)
      .where(eq(externalBackupArtifacts.id, artifactId));
    expect(artifact).toMatchObject({
      status: "failed",
      registerError: "External import destination changed after object validation."
    });
  });

  it("records workspace cleanup success and failure accurately in verification evidence", () => {
    const verification = {
      success: true,
      cleanup: { workspaceRemoved: false, attempted: true, containerRemoved: true }
    } as never;
    externalArtifactVerificationTestHooks.applyWorkspaceCleanupResult(verification, null);
    expect(verification).toMatchObject({ success: true, cleanup: { workspaceRemoved: true } });

    const failed = {
      success: true,
      cleanup: { workspaceRemoved: false, attempted: true, containerRemoved: true }
    } as never;
    externalArtifactVerificationTestHooks.applyWorkspaceCleanupResult(
      failed,
      "workspace cleanup failed"
    );
    expect(failed).toMatchObject({
      success: false,
      error: "workspace cleanup failed",
      cleanup: { workspaceRemoved: false, error: "workspace cleanup failed" }
    });
  });
});
