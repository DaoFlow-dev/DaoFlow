import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRecoveryVerifierArgs: vi.fn(),
  dockerCapture: vi.fn(),
  dockerPipeFileToStdin: vi.fn(),
  dockerWriteStdoutToFile: vi.fn(),
  makeRecoveryVerificationContainer: vi.fn(),
  passed: vi.fn((detail: string) => ({ status: "passed", detail })),
  readMigrationJournal: vi.fn(),
  readObjectCounts: vi.fn(),
  removeRecoveryContainer: vi.fn(),
  runVerifierSql: vi.fn(),
  startAndWaitForRecoveryVerifier: vi.fn(),
  verifyEncryptedSecrets: vi.fn(),
  verifyOwnership: vi.fn(),
  verifySanitizedState: vi.fn()
}));

vi.mock("./control-plane-recovery-docker-runner", () => ({
  dockerCapture: mocks.dockerCapture,
  dockerPipeFileToStdin: mocks.dockerPipeFileToStdin,
  dockerWriteStdoutToFile: mocks.dockerWriteStdoutToFile
}));

vi.mock("./control-plane-recovery-database-queries", () => ({
  passed: mocks.passed,
  readMigrationJournal: mocks.readMigrationJournal,
  readObjectCounts: mocks.readObjectCounts,
  runVerifierSql: mocks.runVerifierSql,
  verifyEncryptedSecrets: mocks.verifyEncryptedSecrets,
  verifyOwnership: mocks.verifyOwnership,
  verifySanitizedState: mocks.verifySanitizedState
}));

vi.mock("./control-plane-recovery-verifier", () => ({
  createRecoveryVerifierArgs: mocks.createRecoveryVerifierArgs,
  makeRecoveryVerificationContainer: mocks.makeRecoveryVerificationContainer,
  removeRecoveryContainer: mocks.removeRecoveryContainer,
  startAndWaitForRecoveryVerifier: mocks.startAndWaitForRecoveryVerifier
}));

import {
  createSanitizedControlPlaneDump,
  verifySanitizedControlPlaneDump
} from "./control-plane-recovery-database-restore";

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

beforeEach(() => {
  mocks.createRecoveryVerifierArgs.mockReturnValue(["run", "verifier"]);
  mocks.dockerCapture.mockResolvedValue("");
  mocks.dockerPipeFileToStdin.mockResolvedValue(undefined);
  mocks.dockerWriteStdoutToFile.mockResolvedValue(undefined);
  mocks.makeRecoveryVerificationContainer.mockReturnValue({
    name: "recovery_217_prepare",
    databaseUser: "postgres",
    databaseName: "daoflow"
  });
  mocks.readMigrationJournal.mockResolvedValue(dumpEvidence.migrations);
  mocks.readObjectCounts.mockResolvedValue(dumpEvidence.objectCounts);
  mocks.removeRecoveryContainer.mockResolvedValue(true);
  mocks.runVerifierSql.mockResolvedValue(undefined);
  mocks.startAndWaitForRecoveryVerifier.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSanitizedControlPlaneDump", () => {
  it("samples migration and object-count evidence from the restored source dump before sanitizing it", async () => {
    await expect(
      createSanitizedControlPlaneDump({
        bundleId: "recovery_217",
        verifierImage: "pgvector/pgvector:pg17",
        sourceDumpPath: "/tmp/source.dump",
        sanitizedDumpPath: "/tmp/sanitized.dump"
      })
    ).resolves.toEqual(dumpEvidence);

    expect(mocks.dockerPipeFileToStdin).toHaveBeenCalledWith(
      expect.any(Array),
      "/tmp/source.dump",
      "restore the control-plane dump in an isolated verifier",
      undefined
    );
    expect(mocks.readMigrationJournal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runVerifierSql.mock.invocationCallOrder[0]
    );
    expect(mocks.readObjectCounts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runVerifierSql.mock.invocationCallOrder[0]
    );
    expect(mocks.dockerWriteStdoutToFile).toHaveBeenCalledWith(
      expect.any(Array),
      "/tmp/sanitized.dump",
      "create the sanitized control-plane dump",
      undefined
    );
  });
});

describe("verifySanitizedControlPlaneDump", () => {
  it("rejects a second isolated restore whose object counts differ from the dump evidence", async () => {
    mocks.readObjectCounts.mockResolvedValue({
      ...dumpEvidence.objectCounts,
      backupRuns: dumpEvidence.objectCounts.backupRuns + 1
    });
    mocks.verifyEncryptedSecrets.mockResolvedValue({ status: "passed", detail: "verified" });
    mocks.verifyOwnership.mockResolvedValue(undefined);
    mocks.verifySanitizedState.mockResolvedValue(undefined);

    await expect(
      verifySanitizedControlPlaneDump({
        bundleId: "recovery_217",
        verifierImage: "pgvector/pgvector:pg17",
        sanitizedDumpPath: "/tmp/sanitized.dump",
        expectedMigrations: dumpEvidence.migrations,
        expectedCounts: dumpEvidence.objectCounts
      })
    ).rejects.toThrow(
      "Sanitized recovery dump object counts do not match the restored source dump."
    );
  });
});
