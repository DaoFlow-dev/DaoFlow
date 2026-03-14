import { Command } from "commander";
import chalk from "chalk";
import { setContext } from "../config";

export function loginCommand(): Command {
  return new Command("login")
    .description("Authenticate with a DaoFlow server")
    .requiredOption("--url <url>", "DaoFlow API URL (e.g. https://daoflow.example.com)")
    .requiredOption("--token <token>", "API token")
    .option("--context <name>", "Context name", "default")
    .action(async (opts: { url: string; token: string; context: string }) => {
      const { url, token, context } = opts;

      // Validate connection
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/health`);
        if (!res.ok) {
          console.error(chalk.red(`✗ Server returned ${res.status}`));
          process.exit(1);
        }
      } catch {
        console.error(chalk.red(`✗ Cannot reach ${url}`));
        process.exit(1);
      }

      setContext(context, { apiUrl: url, token });
      console.log(chalk.green(`✓ Logged in to ${url} as context "${context}"`));
    });
}
