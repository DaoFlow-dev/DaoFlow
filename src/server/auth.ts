import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "../shared/config";

const authMemoryDb = {
  user: [],
  session: [],
  account: [],
  verification: []
};

function resolveAuthBaseURL() {
  return process.env.BETTER_AUTH_URL ?? `http://localhost:${DEFAULT_SERVER_PORT}`;
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
  database: memoryAdapter(authMemoryDb),
  emailAndPassword: {
    enabled: true
  }
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
