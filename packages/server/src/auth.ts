import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/connection";
import { bootstrapOwnerRole, defaultSignupRole } from "@daoflow/shared";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { pool } from "./db/connection";

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
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true
  }),
  emailAndPassword: {
    enabled: true
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        returned: true,
        input: false
      }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Query actual user count from DB instead of in-memory counter.
          // This is correct even when multiple E2E test files run against
          // the same server process, or when the server restarts.
          const result = await pool.query("SELECT count(*)::int AS cnt FROM users");
          const existingUsers = result.rows[0]?.cnt ?? 0;
          return {
            data: {
              ...user,
              role: existingUsers === 0 ? bootstrapOwnerRole : defaultSignupRole
            }
          };
        }
      }
    }
  }
});

export async function ensureAuthReady() {
  // Better Auth with drizzle adapter handles migrations automatically
  // No explicit migration step needed — tables are created on first use
}

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
