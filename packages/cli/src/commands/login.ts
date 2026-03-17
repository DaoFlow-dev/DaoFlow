import { Command } from "commander";
import chalk from "chalk";
import { setContext } from "../config";

export function loginCommand(): Command {
  return new Command("login")
    .description("Authenticate with a DaoFlow server")
    .requiredOption("--url <url>", "DaoFlow API URL (e.g. https://daoflow.example.com)")
    .option("--token <token>", "Session token (from browser or API)")
    .option("--email <email>", "Email address for sign-in")
    .option("--password <password>", "Password for sign-in")
    .option("--context <name>", "Context name", "default")
    .action(
      async (opts: {
        url: string;
        token?: string;
        email?: string;
        password?: string;
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

        if (opts.token) {
          // Direct token mode — user provides session token
          sessionToken = opts.token;
        } else if (opts.email && opts.password) {
          // Email/password sign-in — call Better Auth sign-in API
          console.error(chalk.dim("Signing in..."));
          try {
            const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: opts.email, password: opts.password }),
              redirect: "manual",
            });

            // Extract session cookie from Set-Cookie header
            const setCookie = res.headers.getSetCookie?.() ?? [];
            const sessionCookie = setCookie.find((c: string) =>
              c.startsWith("better-auth.session_token=")
            );

            if (sessionCookie) {
              // Parse cookie value — format: better-auth.session_token=<value>; Path=...
              const match = sessionCookie.match(
                /better-auth\.session_token=([^;]+)/
              );
              if (match) {
                sessionToken = decodeURIComponent(match[1]);
              } else {
                console.error(chalk.red("✗ Could not parse session cookie"));
                process.exit(1);
                return;
              }
            } else {
              // Fallback: check response body for token
              const body = await res.json().catch(() => null);
              if (body?.token) {
                sessionToken = body.token;
              } else {
                const errMsg = body?.message || body?.error || `Status ${res.status}`;
                console.error(chalk.red(`✗ Sign-in failed: ${errMsg}`));
                process.exit(1);
                return;
              }
            }
          } catch (e: any) {
            console.error(chalk.red(`✗ Sign-in failed: ${e.message}`));
            process.exit(1);
            return;
          }
        } else {
          console.error(
            chalk.red("Provide --token or --email/--password to authenticate.")
          );
          process.exit(1);
          return;
        }

        // Verify the token works
        try {
          const res = await fetch(`${baseUrl}/trpc/viewer`, {
            headers: {
              Cookie: `better-auth.session_token=${sessionToken}`,
            },
          });
          if (!res.ok) {
            console.error(chalk.red("✗ Token validation failed — session may be expired"));
            process.exit(1);
          }
        } catch {
          console.error(chalk.yellow("⚠ Could not validate session — saving anyway"));
        }

        setContext(context, { apiUrl: baseUrl, token: sessionToken });
        console.log(
          chalk.green(`✓ Logged in to ${baseUrl} as context "${context}"`)
        );
      }
    );
}
