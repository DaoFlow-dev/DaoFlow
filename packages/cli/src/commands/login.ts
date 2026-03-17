import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { getErrorMessage, isRecord, readString } from "../command-helpers";
import { setContext } from "../config";
import { tryOpenBrowser } from "../browser";

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

async function startSsoFlow(baseUrl: string): Promise<DeviceStartResponse> {
  const res = await fetch(`${baseUrl}/api/v1/cli-auth/start`, {
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
  const res = await fetch(`${baseUrl}/api/v1/cli-auth/exchange`, {
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
    const res = await fetch(
      `${baseUrl}/api/v1/cli-auth/status?requestId=${encodeURIComponent(requestId)}&userCode=${encodeURIComponent(userCode)}`
    );

    if (!res.ok) {
      return null;
    }

    const body = (await res.json().catch(() => null)) as DeviceStatusResponse | null;
    if (body?.status === "approved" && body.exchangeCode) {
      return body.exchangeCode;
    }

    await sleep(intervalSeconds * 1000);
  }

  return null;
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
    .action(
      async (opts: {
        url: string;
        token?: string;
        email?: string;
        password?: string;
        sso?: boolean;
        context: string;
      }) => {
        const { url, context } = opts;
        const baseUrl = url.replace(/\/$/, "");

        // Validate server is reachable
        try {
          const res = await fetch(`${baseUrl}/health`);
          if (!res.ok) {
            console.error(chalk.red(`✗ Server returned ${res.status}`));
            process.exit(1);
          }
        } catch {
          console.error(chalk.red(`✗ Cannot reach ${url}`));
          process.exit(1);
        }

        let sessionToken: string;
        const authModes = [
          Boolean(opts.token),
          Boolean(opts.email || opts.password),
          Boolean(opts.sso)
        ].filter(Boolean).length;

        if (authModes !== 1) {
          console.error(
            chalk.red("Choose exactly one auth mode: --token, --email/--password, or --sso.")
          );
          process.exit(1);
          return;
        }

        if (opts.token) {
          // Direct token mode — user provides session token
          sessionToken = opts.token;
        } else if (opts.sso) {
          console.error(chalk.dim("Starting browser sign-in..."));
          try {
            const device = await startSsoFlow(baseUrl);
            const opened = tryOpenBrowser(device.verificationUri);

            console.error(chalk.dim(`User code: ${device.userCode}`));
            if (opened) {
              console.error(chalk.dim(`Opened ${device.verificationUri}`));
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
                console.error(
                  chalk.yellow(
                    "Browser login was not approved in time. Paste the one-time CLI code shown in the browser."
                  )
                );
                const pastedCode = await prompt("CLI code: ");
                sessionToken = await exchangeSsoCode(
                  baseUrl,
                  device.requestId,
                  device.userCode,
                  pastedCode
                );
              }
            } else {
              console.error(chalk.yellow("No browser could be opened for SSO."));
              console.error(chalk.yellow(`Open this URL manually: ${device.verificationUri}`));
              const pastedCode = await prompt("Paste the one-time CLI code: ");
              sessionToken = await exchangeSsoCode(
                baseUrl,
                device.requestId,
                device.userCode,
                pastedCode
              );
            }
          } catch (error) {
            console.error(chalk.red(`✗ SSO login failed: ${getErrorMessage(error)}`));
            process.exit(1);
            return;
          }
        } else if (opts.email && opts.password) {
          // Email/password sign-in — call Better Auth sign-in API
          console.error(chalk.dim("Signing in..."));
          try {
            const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: opts.email, password: opts.password }),
              redirect: "manual"
            });

            // Extract session cookie from Set-Cookie header
            const setCookie: string[] = res.headers.getSetCookie?.() ?? [];
            const sessionCookie = setCookie.find((c: string) =>
              c.startsWith("better-auth.session_token=")
            );

            if (sessionCookie) {
              // Parse cookie value — format: better-auth.session_token=<value>; Path=...
              const match = sessionCookie.match(/better-auth\.session_token=([^;]+)/);
              if (match) {
                sessionToken = decodeURIComponent(match[1]);
              } else {
                console.error(chalk.red("✗ Could not parse session cookie"));
                process.exit(1);
                return;
              }
            } else {
              // Fallback: check response body for token
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
                const errMsg = body?.message || body?.error || `Status ${res.status}`;
                console.error(chalk.red(`✗ Sign-in failed: ${errMsg}`));
                process.exit(1);
                return;
              }
            }
          } catch (error) {
            console.error(chalk.red(`✗ Sign-in failed: ${getErrorMessage(error)}`));
            process.exit(1);
            return;
          }
        } else {
          console.error(
            chalk.red("Provide --token, --email/--password, or --sso to authenticate.")
          );
          process.exit(1);
          return;
        }

        // Verify the token works
        try {
          const res = await fetch(`${baseUrl}/trpc/viewer`, {
            headers: {
              Cookie: `better-auth.session_token=${sessionToken}`
            }
          });
          if (!res.ok) {
            console.error(chalk.red("✗ Token validation failed — session may be expired"));
            process.exit(1);
          }
        } catch {
          console.error(chalk.yellow("⚠ Could not validate session — saving anyway"));
        }

        setContext(context, { apiUrl: baseUrl, token: sessionToken });
        console.log(chalk.green(`✓ Logged in to ${baseUrl} as context "${context}"`));
      }
    );
}
