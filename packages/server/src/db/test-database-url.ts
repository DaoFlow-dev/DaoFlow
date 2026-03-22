const DEFAULT_DATABASE_URL = "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";

export function resolveConfiguredDatabaseUrl() {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function resolveTestDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const baseUrl = new URL(resolveConfiguredDatabaseUrl());
  const databaseName = baseUrl.pathname.replace(/^\//, "") || "daoflow";

  if (!databaseName.endsWith("_test")) {
    baseUrl.pathname = `/${databaseName}_test`;
  }

  return baseUrl.toString();
}
