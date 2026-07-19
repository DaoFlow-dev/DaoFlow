import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSanitizedControlPlaneDump: vi.fn(),
  dumpControlPlane: vi.fn(),
  inspectControlPlanePostgres: vi.fn(),
  readMigrationJournal: vi.fn(),
  readObjectCounts: vi.fn(),
  sha256File: vi.fn(),
  statSync: vi.fn(),
  verifySanitizedControlPlaneDump: vi.fn()
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  statSync: mocks.statSync
}));

vi.mock("./control-plane-recovery-docker", () => ({
  inspectControlPlanePostgres: mocks.inspectControlPlanePostgres
}));

vi.mock("./control-plane-recovery-database-queries", () => ({
  readMigrationJournal: mocks.readMigrationJournal,
  readObjectCounts: mocks.readObjectCounts
}));

vi.mock("./control-plane-recovery-database-restore", () => ({
  createSanitizedControlPlaneDump: mocks.createSanitizedControlPlaneDump,
  dumpControlPlane: mocks.dumpControlPlane,
  verifySanitizedControlPlaneDump: mocks.verifySanitizedControlPlaneDump
}));

vi.mock("./control-plane-recovery-safety", () => ({
  RECOVERY_SANITIZED_FIELDS: ["sessions.*"],
  sha256File: mocks.sha256File
}));

import { prepareSanitizedControlPlaneRecoveryDump } from "./control-plane-recovery-database";

const dumpEvidence = {
  migrations: {
    count: 1,
    latestHash: "dump-migration",
    applied: [{ hash: "dump-migration", createdAt: 1 }]
  },
  objectCounts: {
    teams: 2,
    users: 3,
    projects: 5,
    servers: 7,
    auditEntries: 11,
    backupRuns: 13
  }
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("prepareSanitizedControlPlaneRecoveryDump", () => {
  it("uses evidence from the restored source dump for the second isolated restore", async () => {
    mocks.inspectControlPlanePostgres.mockResolvedValue({
      containerName: "live-postgres",
      databaseUser: "postgres",
      databaseName: "daoflow",
      sourcePostgresVersion: "17.2",
      verifierImage: "pgvector/pgvector:pg17"
    });
    mocks.createSanitizedControlPlaneDump.mockResolvedValue(dumpEvidence);
    mocks.verifySanitizedControlPlaneDump.mockResolvedValue({
      checks: {},
      objectCounts: dumpEvidence.objectCounts
    });
    mocks.sha256File.mockResolvedValue("a".repeat(64));
    mocks.statSync.mockReturnValue({ size: 123 });

    const prepared = await prepareSanitizedControlPlaneRecoveryDump({
      bundleId: "recovery_217",
      workspace: "/tmp/recovery"
    });

    expect(mocks.readMigrationJournal).not.toHaveBeenCalled();
    expect(mocks.readObjectCounts).not.toHaveBeenCalled();
    expect(mocks.verifySanitizedControlPlaneDump).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMigrations: dumpEvidence.migrations,
        expectedCounts: dumpEvidence.objectCounts
      })
    );
    expect(prepared.migrations).toEqual(dumpEvidence.migrations);
    expect(prepared.objectCounts).toEqual(dumpEvidence.objectCounts);
  });
});
