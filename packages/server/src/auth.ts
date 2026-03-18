import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sql } from "drizzle-orm";
import { db } from "./db/connection";
import { users } from "./db/schema/users";
import { bootstrapOwnerRole, defaultSignupRole } from "@daoflow/shared";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { resolveEmailSender } from "./email-transport";

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

const authBaseURL = resolveAuthBaseURL();
const isHTTPS = authBaseURL.startsWith("https://");
const emailSender = resolveEmailSender();

export const auth = betterAuth({
  appName: "DaoFlow",
  baseURL: authBaseURL,
  secret: resolveAuthSecret(),
  advanced: {
    // Better Auth defaults to Secure cookies in production mode, but if
    // the server is behind plain HTTP (CI, local dev without TLS), the
    // browser silently rejects them.  Only set Secure when using HTTPS.
    useSecureCookies: isHTTPS
  },
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
    enabled: true,
    autoSignIn: true,
    sendResetPassword: emailSender
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
          // Query the database to check if any users exist. This is
          // restart-safe — unlike the previous in-memory counter, it
          // cannot be tricked by restarting the server.
          const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
          const isFirstUser = Number(result.count) === 0;
          return {
            data: {
              ...user,
              role: isFirstUser ? bootstrapOwnerRole : defaultSignupRole
            }
          };
        }
      }
    }
  }
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
