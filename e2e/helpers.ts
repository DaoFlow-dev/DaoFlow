import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { e2eAdminUser, type E2EAuthUser } from "../packages/server/src/testing/e2e-auth-users";

/** Auth operations can be slow in CI — use a generous timeout. */
const AUTH_TIMEOUT = 30_000;
const PLAYWRIGHT_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e";
const PLAYWRIGHT_DATABASE_NAME =
  new URL(PLAYWRIGHT_DATABASE_URL).pathname.replace(/^\//, "") || "daoflow_e2e";
const DAOFLOW_DEV_COMPOSE_FILE = process.env.DAOFLOW_DEV_COMPOSE_FILE ?? "docker-compose.dev.yml";

async function expectSignedIn(page: Page) {
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: AUTH_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: AUTH_TIMEOUT
  });
}

const QUERY_PROCEDURES = new Set(["environmentVariables"]);

async function openSignInForm(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("tab", { name: "Sign in" })
    .click()
    .catch(() => undefined);
}

async function openSignUpForm(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Sign up" }).click();
}

export async function signInWithEmailPassword(
  page: Page,
  user: Pick<E2EAuthUser, "email" | "password">
) {
  await openSignInForm(page);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

export async function signInAsAdmin(page: Page) {
  await signInWithEmailPassword(page, e2eAdminUser);
}

// Compatibility alias while the suite transitions away from owner-named helpers.
export const signInAsOwner = signInAsAdmin;

export async function signUpWithEmailPassword(
  page: Page,
  user: Pick<E2EAuthUser, "name" | "email" | "password">
) {
  await openSignUpForm(page);
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expectSignedIn(page);
}

export async function signOut(page: Page) {
  await page.locator(".sidebar__user-card").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: AUTH_TIMEOUT });
}

export async function getCurrentSession(page: Page) {
  const response = await page.context().request.get("http://127.0.0.1:3000/api/auth/get-session");

  if (!response.ok()) {
    throw new Error(`get-session failed (${response.status()}): ${await response.text()}`);
  }

  return (await response.json()) as {
    session: { id: string };
    user: { id: string; email: string; role?: string | null; name?: string | null };
  };
}

export async function createPasswordResetToken(userId: string) {
  const token = `pwreset_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const sqlQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const verificationId = `ver_${token}`.slice(0, 32);
  const sql = `insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
values (${sqlQuote(verificationId)}, ${sqlQuote(`reset-password:${token}`)}, ${sqlQuote(userId)}, now() + interval '1 hour', now(), now());`;

  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      DAOFLOW_DEV_COMPOSE_FILE,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "daoflow",
      "-d",
      PLAYWRIGHT_DATABASE_NAME,
      "-c",
      sql
    ],
    { stdio: "pipe" }
  );

  return token;
}

type TrpcEnvelope<T> =
  | {
      result?: {
        data?: {
          json?: T;
        } & T;
      };
      error?: {
        json?: {
          message?: string;
        };
      };
    }
  | T;

function unwrapTrpcResponse<T>(payload: TrpcEnvelope<T>): T {
  const envelope = payload as {
    result?: { data?: { json?: T } & T };
    error?: { json?: { message?: string } };
  };

  if (envelope.error?.json?.message) {
    throw new Error(envelope.error.json.message);
  }

  if (envelope.result?.data && "json" in envelope.result.data) {
    return envelope.result.data.json as T;
  }

  if (envelope.result?.data) {
    return envelope.result.data as T;
  }

  return payload as T;
}

export async function trpcRequest<T>(
  page: Page,
  procedure: string,
  input?: Record<string, unknown>
): Promise<T> {
  const isQuery = QUERY_PROCEDURES.has(procedure);
  const response = await page.evaluate(
    async ({ procedureName, procedureInput, queryMode }) => {
      const search =
        queryMode && procedureInput
          ? `?input=${encodeURIComponent(JSON.stringify(procedureInput))}`
          : "";
      const res = await fetch(`/trpc/${procedureName}${search}`, {
        method: procedureInput && !queryMode ? "POST" : "GET",
        headers: procedureInput && !queryMode ? { "Content-Type": "application/json" } : undefined,
        body: procedureInput && !queryMode ? JSON.stringify(procedureInput) : undefined,
        credentials: "include"
      });

      const payload = (await res.json().catch(() => null)) as unknown;

      return {
        ok: res.ok,
        status: res.status,
        payload
      };
    },
    {
      procedureName: procedure,
      procedureInput: input ?? null,
      queryMode: isQuery
    }
  );

  if (!response.ok) {
    const message =
      (response.payload as { error?: { json?: { message?: string } } } | null)?.error?.json
        ?.message ?? `Request to ${procedure} failed with status ${response.status}`;
    throw new Error(message);
  }

  return unwrapTrpcResponse<T>(response.payload as TrpcEnvelope<T>);
}
