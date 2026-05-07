import { buildAuthHeaders } from "../auth-headers";
import { isRecord, readString } from "../command-helpers";
import { LoginCommandError } from "./output";
import type { LoginRuntime } from "./runtime";
import type {
  CredentialValidationResult,
  DeviceExchangeResponse,
  DeviceStartResponse,
  DeviceStatusResponse,
  LoginResponseBody
} from "./types";

export async function ensureServerAvailable(
  baseUrl: string,
  displayUrl: string,
  runtime: LoginRuntime
): Promise<void> {
  try {
    const response = await runtime.fetch(`${baseUrl}/health`);
    if (!response.ok) {
      throw new LoginCommandError(`Server returned ${response.status}`, "SERVER_ERROR");
    }
  } catch (error) {
    if (error instanceof LoginCommandError) {
      throw error;
    }

    throw new LoginCommandError(`Cannot reach ${displayUrl}`, "SERVER_UNREACHABLE");
  }
}

export async function startSsoFlow(
  baseUrl: string,
  runtime: LoginRuntime
): Promise<DeviceStartResponse> {
  const response = await runtime.fetch(`${baseUrl}/api/v1/cli-auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Could not start SSO login: ${response.status}`);
  }

  return (await response.json()) as DeviceStartResponse;
}

export async function exchangeSsoCode(
  baseUrl: string,
  requestId: string,
  userCode: string,
  exchangeCode: string,
  runtime: LoginRuntime
): Promise<string> {
  const response = await runtime.fetch(`${baseUrl}/api/v1/cli-auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, userCode, exchangeCode })
  });
  const body = (await response.json().catch(() => null)) as DeviceExchangeResponse | null;

  if (!response.ok || !body?.token) {
    throw new Error(body?.error || `CLI code exchange failed (${response.status})`);
  }

  return body.token;
}

export async function pollSsoCode(
  baseUrl: string,
  requestId: string,
  userCode: string,
  pollToken: string,
  intervalSeconds: number,
  expiresAtIso: string,
  runtime: LoginRuntime
): Promise<string | null> {
  const expiresAt = new Date(expiresAtIso).getTime();

  while (Date.now() < expiresAt) {
    const response = await runtime.fetch(
      `${baseUrl}/api/v1/cli-auth/status?requestId=${encodeURIComponent(requestId)}&userCode=${encodeURIComponent(userCode)}&pollToken=${encodeURIComponent(pollToken)}`
    );
    const rawBody = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const errorMessage = isRecord(rawBody) ? readString(rawBody.error) : null;
      if (response.status === 403) {
        throw new Error(errorMessage || `CLI auth polling rejected (${response.status})`);
      }

      return null;
    }

    const body = rawBody as DeviceStatusResponse | null;
    if (body?.status === "approved" && body.exchangeCode) {
      return body.exchangeCode;
    }

    await runtime.sleep(intervalSeconds * 1000);
  }

  return null;
}

export async function signInWithEmailPassword(
  baseUrl: string,
  email: string,
  password: string,
  mfa: { totpCode?: string; recoveryCode?: string },
  runtime: LoginRuntime
): Promise<string> {
  const response = await runtime.fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual"
  });

  const setCookie: string[] = response.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookie.find(
    (cookie) =>
      cookie.startsWith("better-auth.session_token=") ||
      cookie.startsWith("__Secure-better-auth.session_token=")
  );

  if (sessionCookie) {
    const match = sessionCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
    if (!match?.[1]) {
      throw new LoginCommandError("Could not parse session cookie", "SESSION_COOKIE_INVALID");
    }

    return decodeURIComponent(match[1]);
  }

  const rawBody = (await response.json().catch(() => null)) as unknown;
  const body: LoginResponseBody | null = isRecord(rawBody)
    ? {
        token: readString(rawBody.token),
        message: readString(rawBody.message),
        error: readString(rawBody.error),
        twoFactorRedirect: rawBody.twoFactorRedirect === true
      }
    : null;

  if (body?.token) {
    return body.token;
  }

  if (body?.twoFactorRedirect) {
    return verifyEmailPasswordMfa(baseUrl, setCookie, mfa, runtime);
  }

  const errorMessage = body?.message || body?.error || `Status ${response.status}`;
  throw new LoginCommandError(`Sign-in failed: ${errorMessage}`, "AUTH_FAILED");
}

async function verifyEmailPasswordMfa(
  baseUrl: string,
  signInCookies: string[],
  mfa: { totpCode?: string; recoveryCode?: string },
  runtime: LoginRuntime
): Promise<string> {
  if (mfa.totpCode && mfa.recoveryCode) {
    throw new LoginCommandError(
      "Use either --totp-code or --recovery-code, not both.",
      "INVALID_MFA_MODE"
    );
  }

  const code = mfa.totpCode ?? mfa.recoveryCode;
  if (!code) {
    throw new LoginCommandError(
      "MFA is required. Re-run with --totp-code or --recovery-code, or use --sso.",
      "MFA_REQUIRED"
    );
  }

  const response = await runtime.fetch(
    `${baseUrl}/api/auth/two-factor/${mfa.recoveryCode ? "verify-backup-code" : "verify-totp"}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: buildCookieHeader(signInCookies)
      },
      body: JSON.stringify({ code }),
      redirect: "manual"
    }
  );

  const sessionCookie = (response.headers.getSetCookie?.() ?? []).find(
    (cookie) =>
      cookie.startsWith("better-auth.session_token=") ||
      cookie.startsWith("__Secure-better-auth.session_token=")
  );
  if (sessionCookie) {
    const match = sessionCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  const body = (await response.json().catch(() => null)) as unknown;
  const message = isRecord(body) ? readString(body.message) || readString(body.error) : null;
  throw new LoginCommandError(
    `MFA verification failed: ${message || `Status ${response.status}`}`,
    "MFA_FAILED"
  );
}

function buildCookieHeader(cookies: string[]) {
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
}

export async function validateCredential(
  baseUrl: string,
  token: string,
  runtime: LoginRuntime
): Promise<CredentialValidationResult> {
  const response = await runtime.fetch(`${baseUrl}/trpc/viewer`, {
    headers: buildAuthHeaders(token)
  });

  if (!response.ok) {
    return {
      ok: false,
      authMethod: token.startsWith("dfl_") ? "api-token" : "session",
      principalEmail: null,
      role: null
    };
  }

  const payload = (await response.json().catch(() => null)) as {
    result?: {
      data?: {
        principal?: { email?: string | null };
        authz?: { authMethod?: "session" | "api-token"; role?: string | null };
      };
    };
  } | null;
  const data = payload?.result?.data;

  return {
    ok: true,
    authMethod: data?.authz?.authMethod ?? (token.startsWith("dfl_") ? "api-token" : "session"),
    principalEmail: data?.principal?.email ?? null,
    role: data?.authz?.role ?? null
  };
}
