const DEFAULT_DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";
const POSTGRES_DATABASE_NAME_LIMIT = 63;

export function resolveConfiguredDatabaseUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

function resolveVitestWorkerSuffix() {
  const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID;
  if (!workerId) {
    return "";
  }

  return `_w${workerId.replaceAll(/[^a-zA-Z0-9_-]/g, "")}`;
}

function applyDatabaseNameSuffix(databaseName: string, suffix: string) {
  if (!suffix) {
    return databaseName;
  }

  const truncatedBaseName = databaseName.slice(
    0,
    Math.max(1, POSTGRES_DATABASE_NAME_LIMIT - suffix.length)
  );

  return `${truncatedBaseName}${suffix}`;
}

export function resolveTestDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const baseUrl = new URL(resolveConfiguredDatabaseUrl());
  const databaseName = baseUrl.pathname.replace(/^\//, "") || "daoflow";
  const workerSuffix = resolveVitestWorkerSuffix();
  const unsuffixedDatabaseName =
    workerSuffix && databaseName.endsWith(workerSuffix)
      ? databaseName.slice(0, -workerSuffix.length)
      : databaseName;
  const testDatabaseName = unsuffixedDatabaseName.endsWith("_test")
    ? unsuffixedDatabaseName
    : `${unsuffixedDatabaseName}_test`;

  baseUrl.pathname = `/${applyDatabaseNameSuffix(testDatabaseName, workerSuffix)}`;

  return baseUrl.toString();
}
