import { expect, type Page } from "@playwright/test";

/**
 * Shared owner credentials used across all E2E test files.
 * The first call to signUpOwner() creates this user (gets "owner" role).
 * All subsequent tests call signInAsOwner() to reuse them.
 */
export const OWNER_EMAIL = "e2e-owner@daoflow.local";
export const OWNER_PASSWORD = "owner-e2e-pass-2026";
export const OWNER_NAME = "E2E Owner";

/** Auth operations can be slow in CI — use a generous timeout. */
const AUTH_TIMEOUT = 30_000;

type AuthResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

async function authRequest(
  page: Page,
  pathname: "/api/auth/sign-up/email" | "/api/auth/sign-in/email",
  payload: Record<string, unknown>
): Promise<AuthResponse> {
  const response = await page.context().request.post(pathname, {
    data: payload,
    headers: { "Content-Type": "application/json" }
  });

  const result = (await response.json().catch(() => null)) as unknown;

  return {
    ok: response.ok(),
    status: response.status(),
    payload: result
  };
}

async function expectSignedIn(page: Page) {
  const response = await page.context().request.get("/api/auth/get-session");
  const payload = (await response.json().catch(() => null)) as {
    user?: {
      email?: string;
    };
  } | null;

  expect(response.ok()).toBe(true);
  expect(payload?.user?.email).toBe(OWNER_EMAIL);

  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: AUTH_TIMEOUT });
}

const QUERY_PROCEDURES = new Set(["environmentVariables"]);

/** Sign up the shared owner account. Call this ONCE (in global-setup). */
export async function signUpOwner(page: Page) {
  const signUp = await authRequest(page, "/api/auth/sign-up/email", {
    name: OWNER_NAME,
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD
  });

  if (signUp.ok) {
    await expectSignedIn(page);
    return;
  }

  const message = JSON.stringify(signUp.payload).toLowerCase();
  if (!message.includes("exists")) {
    throw new Error(`Owner sign-up failed (${signUp.status}): ${JSON.stringify(signUp.payload)}`);
  }

  const signIn = await authRequest(page, "/api/auth/sign-in/email", {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD
  });

  if (!signIn.ok) {
    throw new Error(`Owner sign-in failed (${signIn.status}): ${JSON.stringify(signIn.payload)}`);
  }

  await expectSignedIn(page);
}

/** Sign in as the shared owner. Call this in every other test file. */
export async function signInAsOwner(page: Page) {
  const signIn = await authRequest(page, "/api/auth/sign-in/email", {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD
  });

  if (!signIn.ok) {
    throw new Error(`Owner sign-in failed (${signIn.status}): ${JSON.stringify(signIn.payload)}`);
  }

  await expectSignedIn(page);
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
