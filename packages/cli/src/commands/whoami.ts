import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { createClient, type RouterOutputs } from "../trpc-client";
import { getCurrentContext } from "../config";

export function whoamiCommand(): Command {
  return new Command("whoami")
    .description("Show current principal, role, and scopes")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const ctx = getCurrentContext();

      if (!ctx) {
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: "Not logged in", code: "NOT_LOGGED_IN" }));
        } else {
          console.error(chalk.yellow("Not logged in. Run: daoflow login"));
        }
        process.exit(1);
      }

      const trpc = createClient(ctx);

      try {
        const viewer: RouterOutputs["viewer"] = await trpc.viewer.query();

        if (isJson) {
          console.log(
            JSON.stringify({
              ok: true,
              data: {
                principal: viewer.principal,
                role: viewer.authz.role,
                scopes: viewer.authz.capabilities,
                authMethod: viewer.authz.authMethod,
                token: viewer.authz.token,
                session: viewer.session
              }
            })
          );
        } else {
          console.log(chalk.bold("\n  Identity\n"));
          console.log(`  Principal: ${viewer.principal.email}`);
          console.log(`  Name:      ${viewer.principal.name ?? chalk.dim("—")}`);
          console.log(`  Type:      ${chalk.cyan(viewer.principal.type)}`);
          console.log(`  Auth:      ${chalk.cyan(viewer.authz.authMethod)}`);
          console.log(`  Role:     ${chalk.cyan(viewer.authz.role)}`);
          if (viewer.session) {
            console.log(`  Session:   ${chalk.dim(viewer.session.id.slice(0, 12) + "…")}`);
            console.log(`  Expires:   ${chalk.dim(viewer.session.expiresAt)}`);
          } else if (viewer.authz.token) {
            console.log(`  Token:     ${chalk.dim(viewer.authz.token.prefix + "…")}`);
            console.log(`  Expires:   ${chalk.dim(viewer.authz.token.expiresAt ?? "never")}`);
          }
          console.log(`  Scopes:   ${viewer.authz.capabilities.length} granted\n`);
        }
      } catch (err) {
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: getErrorMessage(err),
              code: "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
        }
        process.exit(1);
      }
    });
}
