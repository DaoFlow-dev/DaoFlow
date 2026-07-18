import { describe, expect, it } from "vitest";
import { deriveTestRunLock } from "./test-run-global-setup";

describe("server test run advisory lock", () => {
  it("uses the maintenance database and a stable lock for the target database name", () => {
    const first = deriveTestRunLock(
      "postgresql://daoflow:secret@localhost:5432/daoflow_test?sslmode=disable"
    );
    const second = deriveTestRunLock("postgresql://other:ignored@127.0.0.1:5432/daoflow_test");

    expect(first.maintenanceDatabaseUrl).toBe(
      "postgresql://daoflow:secret@localhost:5432/postgres?sslmode=disable"
    );
    expect(first.advisoryLockKeys).toEqual(second.advisoryLockKeys);
  });

  it("uses different lock keys for different test database names", () => {
    const primary = deriveTestRunLock("postgresql://daoflow:secret@localhost:5432/daoflow_test");
    const secondary = deriveTestRunLock(
      "postgresql://daoflow:secret@localhost:5432/daoflow_test_worker"
    );

    expect(primary.advisoryLockKeys).not.toEqual(secondary.advisoryLockKeys);
  });
});
