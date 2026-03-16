import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";
import { getCurrentContext } from "../config";

export function whoamiCommand(): Command {
  return new Command("whoami")
    .description("Show current principal, role, and scopes")
    .action(async () => {
      const isJson = whoamiCommand().parent?.opts().json;
      const ctx = getCurrentContext();

      if (!ctx) {
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: "Not logged in", code: "NOT_LOGGED_IN" }));
        } else {
          console.error(chalk.yellow("Not logged in. Run: daoflow login"));
        }
        process.exit(1);
      }

      const api = new ApiClient(ctx);

      try {
        const viewer = await api.get<{
          user: { id: string; email: string; name: string | null };
          session: { id: string; expiresAt: string };
          authz: { role: string; capabilities: string[] };
        }>("/trpc/viewer");

        if (isJson) {
          console.log(
            JSON.stringify({
              ok: true,
              data: {
                principal: viewer.user,
                role: viewer.authz.role,
                scopes: viewer.authz.capabilities,
                session: viewer.session
              }
            })
          );
        } else {
          console.log(chalk.bold("\n  Identity\n"));
          console.log(`  User:     ${viewer.user.email}`);
          console.log(`  Name:     ${viewer.user.name ?? chalk.dim("—")}`);
          console.log(`  Role:     ${chalk.cyan(viewer.authz.role)}`);
          console.log(`  Session:  ${chalk.dim(viewer.session.id.slice(0, 12) + "…")}`);
          console.log(`  Expires:  ${chalk.dim(viewer.session.expiresAt)}`);
          console.log(
            `  Scopes:   ${viewer.authz.capabilities.length} granted\n`
          );
        }
      } catch (err) {
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Unknown error",
              code: "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        }
        process.exit(1);
      }
    });
}
