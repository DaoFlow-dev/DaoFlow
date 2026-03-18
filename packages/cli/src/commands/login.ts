import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import {
  getErrorMessage,
  isRecord,
  readString,
  resolveCommandJsonOption
} from "../command-helpers";
import { setContext } from "../config";
import { tryOpenBrowser } from "../browser";
import { buildAuthHeaders } from "../auth-headers";

interface LoginResponseBody {
  token?: string;
  message?: string;
  error?: string;
}

interface DeviceStartResponse {
  ok: boolean;
  requestId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: string;
}

interface DeviceStatusResponse {
  ok: boolean;
  status: "pending" | "approved";
  exchangeCode: string | null;
}

interface DeviceExchangeResponse {
  ok: boolean;
  token?: string;
  error?: string;
}

type LoginAuthMode = "token" | "email-password" | "sso";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface LoginRuntime {
  fetch(this: void, input: string | URL | Request, init?: RequestInit): Promise<Response>;
  prompt(this: void, question: string): Promise<string>;
  sleep(this: void, ms: number): Promise<void>;
  tryOpenBrowser(this: void, url: string): boolean;
}

export const loginRuntime: LoginRuntime = {
  fetch: (input, init) => globalThis.fetch(input, init),
  prompt,
  sleep,
  tryOpenBrowser
};

function emitLoginError(
  isJson: boolean,
  error: string,
  code: string,
  extra?: Record<string, unknown>
): void {
  if (isJson) {
    console.log(JSON.stringify({ ...(extra ?? {}), ok: false, error, code }));
  } else {
    console.error(chalk.red(`✗ ${error}`));
  }
}

async function startSsoFlow(baseUrl: string): Promise<DeviceStartResponse> {
  const res = await loginRuntime.fetch(`${baseUrl}/api/v1/cli-auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  if (!res.ok) {
    throw new Error(`Could not start SSO login: ${res.status}`);
  }

  return (await res.json()) as DeviceStartResponse;
}

async function exchangeSsoCode(
  baseUrl: string,
  requestId: string,
  userCode: string,
  exchangeCode: string
): Promise<string> {
  const res = await loginRuntime.fetch(`${baseUrl}/api/v1/cli-auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, userCode, exchangeCode })
  });
  const body = (await res.json().catch(() => null)) as DeviceExchangeResponse | null;

  if (!res.ok || !body?.token) {
    throw new Error(body?.error || `CLI code exchange failed (${res.status})`);
  }

  return body.token;
}

async function pollSsoCode(
  baseUrl: string,
  requestId: string,
  userCode: string,
  intervalSeconds: number,
  expiresAtIso: string
): Promise<string | null> {
  const expiresAt = new Date(expiresAtIso).getTime();

  while (Date.now() < expiresAt) {
    const res = await loginRuntime.fetch(
      `${baseUrl}/api/v1/cli-auth/status?requestId=${encodeURIComponent(requestId)}&userCode=${encodeURIComponent(userCode)}`
    );

    if (!res.ok) {
      return null;
    }

    const body = (await res.json().catch(() => null)) as DeviceStatusResponse | null;
    if (body?.status === "approved" && body.exchangeCode) {
      return body.exchangeCode;
    }

    await loginRuntime.sleep(intervalSeconds * 1000);
  }

  return null;
}

async function validateCredential(
  baseUrl: string,
  token: string
): Promise<{
  ok: boolean;
  authMethod: "session" | "api-token";
  principalEmail: string | null;
  role: string | null;
}> {
  const res = await loginRuntime.fetch(`${baseUrl}/trpc/viewer`, {
    headers: buildAuthHeaders(token)
  });

  if (!res.ok) {
    return {
      ok: false,
      authMethod: token.startsWith("dfl_") ? "api-token" : "session",
      principalEmail: null,
      role: null
    };
  }

  const payload = (await res.json().catch(() => null)) as {
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
export function loginCommand(): Command {
  return new Command("login")
    .description("Authenticate with a DaoFlow server")
    .requiredOption("--url <url>", "DaoFlow API URL (e.g. https://daoflow.example.com)")
    .option("--token <token>", "Session token (from browser or API)")
    .option("--email <email>", "Email address for sign-in")
    .option("--password <password>", "Password for sign-in")
    .option("--sso", "Start browser-based CLI sign-in")
    .option("--context <name>", "Context name", "default")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          url: string;
          token?: string;
          email?: string;
          password?: string;
          sso?: boolean;
          context: string;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);
        const { url, context } = opts;
        const baseUrl = url.replace(/\/$/, "");

        try {
          const res = await loginRuntime.fetch(`${baseUrl}/health`);
          if (!res.ok) {
            emitLoginError(isJson, `Server returned ${res.status}`, "SERVER_ERROR");
            process.exit(1);
            return;
          }
        } catch {
          emitLoginError(isJson, `Cannot reach ${url}`, "SERVER_UNREACHABLE");
          process.exit(1);
          return;
        }

        const authModes = [
          Boolean(opts.token),
          Boolean(opts.email || opts.password),
          Boolean(opts.sso)
        ].filter(Boolean).length;

        if (authModes !== 1) {
          emitLoginError(
            isJson,
            "Choose exactly one auth mode: --token, --email/--password, or --sso.",
            "INVALID_AUTH_MODE"
          );
          process.exit(1);
          return;
        }

        let sessionToken: string;
        let authMode: LoginAuthMode;

        if (opts.token) {
          authMode = "token";
          sessionToken = opts.token;
        } else if (opts.sso) {
          authMode = "sso";
          if (!isJson) {
            console.error(chalk.dim("Starting browser sign-in..."));
          }

          try {
            const device = await startSsoFlow(baseUrl);
            const opened = loginRuntime.tryOpenBrowser(device.verificationUri);

            if (!isJson) {
              console.error(chalk.dim(`Verification URL: ${device.verificationUri}`));
              console.error(chalk.dim(`User code: ${device.userCode}`));
            }
            if (opened) {
              if (!isJson) {
                console.error(
                  chalk.dim(
                    "Opened a browser window. If it did not appear, open the verification URL manually."
                  )
                );
              }
              const exchangeCode = await pollSsoCode(
                baseUrl,
                device.requestId,
                device.userCode,
                device.intervalSeconds,
                device.expiresAt
              );

              if (exchangeCode) {
                sessionToken = await exchangeSsoCode(
                  baseUrl,
                  device.requestId,
                  device.userCode,
                  exchangeCode
                );
              } else {
                if (isJson) {
                  emitLoginError(
                    isJson,
                    "Browser login was not approved in time; manual CLI code entry is required.",
                    "SSO_MANUAL_CODE_REQUIRED",
                    {
                      verificationUri: device.verificationUri,
                      userCode: device.userCode,
                      requestId: device.requestId,
                      expiresAt: device.expiresAt
                    }
                  );
                  process.exit(1);
                  return;
                }
                console.error(
                  chalk.yellow(
                    "Browser login was not approved in time. Paste the one-time CLI code shown in the browser."
                  )
                );
                const pastedCode = await loginRuntime.prompt("CLI code: ");
                sessionToken = await exchangeSsoCode(
                  baseUrl,
                  device.requestId,
                  device.userCode,
                  pastedCode
                );
              }
            } else {
              if (isJson) {
                emitLoginError(
                  isJson,
                  "SSO requires manual browser completion because no browser could be opened automatically.",
                  "SSO_MANUAL_CODE_REQUIRED",
                  {
                    verificationUri: device.verificationUri,
                    userCode: device.userCode,
                    requestId: device.requestId,
                    expiresAt: device.expiresAt
                  }
                );
                process.exit(1);
                return;
              }
              console.error(chalk.yellow("No browser could be opened automatically for SSO."));
              console.error(chalk.yellow(`Open this URL manually: ${device.verificationUri}`));
              console.error(
                chalk.dim(
                  "After you approve the CLI session in the browser, paste the one-time CLI code shown on the page."
                )
              );
              const pastedCode = await loginRuntime.prompt("Paste the one-time CLI code: ");
              sessionToken = await exchangeSsoCode(
                baseUrl,
                device.requestId,
                device.userCode,
                pastedCode
              );
            }
          } catch (error) {
            emitLoginError(isJson, `SSO login failed: ${getErrorMessage(error)}`, "AUTH_FAILED");
            process.exit(1);
            return;
          }
        } else if (opts.email && opts.password) {
          authMode = "email-password";
          if (!isJson) {
            console.error(chalk.dim("Signing in..."));
          }

          try {
            const res = await loginRuntime.fetch(`${baseUrl}/api/auth/sign-in/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: opts.email, password: opts.password }),
              redirect: "manual"
            });

            const setCookie: string[] = res.headers.getSetCookie?.() ?? [];
            const sessionCookie = setCookie.find((cookie: string) =>
              cookie.startsWith("better-auth.session_token=")
            );

            if (sessionCookie) {
              const match = sessionCookie.match(/better-auth\.session_token=([^;]+)/);
              if (match) {
                sessionToken = decodeURIComponent(match[1]);
              } else {
                emitLoginError(isJson, "Could not parse session cookie", "SESSION_COOKIE_INVALID");
                process.exit(1);
                return;
              }
            } else {
              const rawBody = (await res.json().catch(() => null)) as unknown;
              const body: LoginResponseBody | null = isRecord(rawBody)
                ? {
                    token: readString(rawBody.token),
                    message: readString(rawBody.message),
                    error: readString(rawBody.error)
                  }
                : null;

              if (body?.token) {
                sessionToken = body.token;
              } else {
                const errorMessage = body?.message || body?.error || `Status ${res.status}`;
                emitLoginError(isJson, `Sign-in failed: ${errorMessage}`, "AUTH_FAILED");
                process.exit(1);
                return;
              }
            }
          } catch (error) {
            emitLoginError(isJson, `Sign-in failed: ${getErrorMessage(error)}`, "AUTH_FAILED");
            process.exit(1);
            return;
          }
        } else {
          emitLoginError(
            isJson,
            "Provide --token, --email/--password, or --sso to authenticate.",
            "INVALID_AUTH_MODE"
          );
          process.exit(1);
          return;
        }

        let validated = true;
        let validatedAuthMethod: "session" | "api-token" = sessionToken.startsWith("dfl_")
          ? "api-token"
          : "session";
        let validatedPrincipalEmail: string | null = null;
        let validatedRole: string | null = null;
        try {
          const validation = await validateCredential(baseUrl, sessionToken);
          if (!validation.ok) {
            emitLoginError(
              isJson,
              "Credential validation failed — token or session may be expired",
              "TOKEN_VALIDATION_FAILED"
            );
            process.exit(1);
            return;
          }
          validatedAuthMethod = validation.authMethod;
          validatedPrincipalEmail = validation.principalEmail;
          validatedRole = validation.role;
        } catch {
          validated = false;
          if (!isJson) {
            console.error(chalk.yellow("Could not validate credential live; saving anyway."));
          }
        }

        setContext(context, {
          apiUrl: baseUrl,
          token: sessionToken,
          authMethod: validatedAuthMethod
        });

        if (isJson) {
          console.log(
            JSON.stringify({
              ok: true,
              data: {
                apiUrl: baseUrl,
                context,
                authMode,
                validated,
                authMethod: validatedAuthMethod,
                principalEmail: validatedPrincipalEmail,
                role: validatedRole
              }
            })
          );
          return;
        }

        const identitySuffix =
          validatedPrincipalEmail && validatedRole
            ? ` (${validatedPrincipalEmail}, ${validatedRole}, ${validatedAuthMethod})`
            : ` (${validatedAuthMethod})`;
        console.log(
          chalk.green(`Logged in to ${baseUrl} as context "${context}"${identitySuffix}`)
        );
      }
    );
}
