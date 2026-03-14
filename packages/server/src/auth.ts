import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/connection";
import { bootstrapOwnerRole, defaultSignupRole } from "@daoflow/shared";
import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "@daoflow/shared";

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
let signUpCount = 0;

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
        before: (user) => {
          // The first user to sign up through Better Auth gets the owner
          // role.  Seed-inserted rows bypass sign-up so they don't
          // increment this counter, which is exactly the behavior we want.
          signUpCount++;
          return Promise.resolve({
            data: {
              ...user,
              role: signUpCount === 1 ? bootstrapOwnerRole : defaultSignupRole
            }
          });
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
