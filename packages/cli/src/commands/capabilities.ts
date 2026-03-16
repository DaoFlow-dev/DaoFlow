import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";
import { getCurrentContext } from "../config";

export function capabilitiesCommand(): Command {
  return new Command("capabilities")
    .alias("caps")
    .description("List all granted scopes for the current token")
    .action(async () => {
      const isJson = capabilitiesCommand().parent?.opts().json;
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
          authz: { role: string; capabilities: string[] };
        }>("/trpc/viewer");

        const caps = viewer.authz.capabilities;

        if (isJson) {
          console.log(
            JSON.stringify({
              ok: true,
              data: {
                role: viewer.authz.role,
                scopes: caps,
                total: caps.length
              }
            })
          );
        } else {
          console.log(chalk.bold(`\n  Capabilities (${viewer.authz.role})\n`));
          const readScopes = caps.filter((s) => s.endsWith(":read"));
          const writeScopes = caps.filter((s) => !s.endsWith(":read"));

          if (readScopes.length > 0) {
            console.log(chalk.dim("  Read:"));
            for (const s of readScopes) {
              console.log(`    ${chalk.green("✓")} ${s}`);
            }
          }
          if (writeScopes.length > 0) {
            console.log(chalk.dim("  Write/Command:"));
            for (const s of writeScopes) {
              console.log(`    ${chalk.green("✓")} ${s}`);
            }
          }
          console.log();
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
