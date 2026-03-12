import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "../shared/config";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function resolveAuthBaseURL() {
  return process.env.BETTER_AUTH_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`;
}

function resolveAuthDatabasePath() {
  if (process.env.BETTER_AUTH_DB_PATH) {
    return process.env.BETTER_AUTH_DB_PATH;
  }

  if (process.env.NODE_ENV === "test") {
    return ":memory:";
  }

  return path.resolve(process.cwd(), "data", "auth.sqlite");
}

function createAuthDatabase() {
  const databasePath = resolveAuthDatabasePath();

  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  return new DatabaseSync(databasePath);
}

function resolveAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) {
    return process.env.BETTER_AUTH_SECRET;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }

  return "daoflow-local-dev-secret-please-change-2026";
}

export const auth = betterAuth({
  appName: "DaoFlow",
  baseURL: resolveAuthBaseURL(),
  secret: resolveAuthSecret(),
  trustedOrigins: [
    `http://localhost:${DEFAULT_CLIENT_PORT}`,
    `http://127.0.0.1:${DEFAULT_CLIENT_PORT}`,
    `http://localhost:${DEFAULT_SERVER_PORT}`,
    `http://127.0.0.1:${DEFAULT_SERVER_PORT}`
  ],
  database: createAuthDatabase(),
  emailAndPassword: {
    enabled: true
  }
});

const authReady = (async () => {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
})();

export async function ensureAuthReady() {
  await authReady;
}

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
