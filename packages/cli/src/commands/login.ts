import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { setContext } from "../config";
import { authenticateForLogin } from "../login/auth-flow";
import { ensureServerAvailable, validateCredential } from "../login/identity-client";
import {
  emitLoginError,
  emitLoginSuccess,
  emitValidationSkipped,
  LoginCommandError
} from "../login/output";
import { loginRuntime } from "../login/runtime";

export { loginRuntime } from "../login/runtime";

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
        await runCommandAction({
          command,
          json: opts.json,
          renderError: (error, ctx) => {
            const loginError =
              error instanceof LoginCommandError
                ? error
                : new LoginCommandError(error.message, error.code, error.extra);
            emitLoginError(ctx.isJson, loginError);
          },
          action: async (ctx) => {
            const { url, context } = opts;
            const baseUrl = url.replace(/\/$/, "");

            await ensureServerAvailable(baseUrl, url, loginRuntime);
            const { authMode, sessionToken } = await authenticateForLogin({
              baseUrl,
              opts,
              isJson: ctx.isJson,
              runtime: loginRuntime
            });

            let validated = true;
            let validatedAuthMethod: "session" | "api-token" = sessionToken.startsWith("dfl_")
              ? "api-token"
              : "session";
            let validatedPrincipalEmail: string | null = null;
            let validatedRole: string | null = null;

            try {
              const validation = await validateCredential(baseUrl, sessionToken, loginRuntime);
              if (!validation.ok) {
                throw new LoginCommandError(
                  "Credential validation failed — token or session may be expired",
                  "TOKEN_VALIDATION_FAILED"
                );
              }
              validatedAuthMethod = validation.authMethod;
              validatedPrincipalEmail = validation.principalEmail;
              validatedRole = validation.role;
            } catch (error) {
              if (error instanceof LoginCommandError) {
                throw error;
              }

              validated = false;
              emitValidationSkipped(ctx.isJson);
            }

            setContext(context, {
              apiUrl: baseUrl,
              token: sessionToken,
              authMethod: validatedAuthMethod
            });

            return ctx.complete({
              json: {
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
              },
              human: () => {
                emitLoginSuccess({
                  isJson: false,
                  apiUrl: baseUrl,
                  context,
                  authMode,
                  validated,
                  authMethod: validatedAuthMethod,
                  principalEmail: validatedPrincipalEmail,
                  role: validatedRole
                });
              }
            });
          }
        });
      }
    );
}
