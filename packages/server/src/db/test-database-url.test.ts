import { afterEach, describe, expect, it } from "vitest";
import { resolveConfiguredDatabaseUrl, resolveTestDatabaseUrl } from "./test-database-url";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGINAL_VITEST_WORKER_ID = process.env.VITEST_WORKER_ID;
const ORIGINAL_VITEST_POOL_ID = process.env.VITEST_POOL_ID;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnv("DATABASE_URL", ORIGINAL_DATABASE_URL);
  restoreEnv("TEST_DATABASE_URL", ORIGINAL_TEST_DATABASE_URL);
  restoreEnv("VITEST_WORKER_ID", ORIGINAL_VITEST_WORKER_ID);
  restoreEnv("VITEST_POOL_ID", ORIGINAL_VITEST_POOL_ID);
});

describe("test database URL resolution", () => {
  it("prefers the explicit test database URL when configured", () => {
    process.env.TEST_DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/custom_test";
    process.env.DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/ignored";

    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it("appends the test suffix when no worker suffix is set", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VITEST_WORKER_ID;
    delete process.env.VITEST_POOL_ID;
    process.env.DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";

    expect(resolveConfiguredDatabaseUrl()).toBe(process.env.DATABASE_URL);
    expect(resolveTestDatabaseUrl()).toBe(
      "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_test"
    );
  });

  it("adds the Vitest worker suffix to the test database name", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VITEST_POOL_ID;
    process.env.VITEST_WORKER_ID = "7";
    process.env.DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";

    expect(resolveTestDatabaseUrl()).toBe(
      "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_test_w7"
    );
  });

  it("does not duplicate the worker suffix when the configured database name already has it", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VITEST_POOL_ID;
    process.env.VITEST_WORKER_ID = "3";
    process.env.DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_w3";

    expect(resolveTestDatabaseUrl()).toBe(
      "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_test_w3"
    );
  });

  it("truncates long database names before appending the worker suffix", () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VITEST_POOL_ID;
    process.env.VITEST_WORKER_ID = "worker-123";
    process.env.DATABASE_URL =
      "postgresql://daoflow:daoflow_dev@localhost:5432/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijk";

    const resolvedUrl = new URL(resolveTestDatabaseUrl());
    const databaseName = resolvedUrl.pathname.replace(/^\//, "");

    expect(databaseName).toHaveLength(63);
    expect(databaseName.endsWith("_wworker-123")).toBe(true);
    expect(databaseName.startsWith("abcdefghijklmnopqrstuvwxyz")).toBe(true);
  });
});
