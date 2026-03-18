/**
 * diff.ts — Compare two deployments (desired vs actual state).
 *
 * Per the CLI contract:
 *   diff → planning lane, deploy:read
 *
 * Supports:
 *   daoflow diff --a <deploymentId> --b <deploymentId> [--json]
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare two deployments or config states")
    .requiredOption("--a <id>", "First deployment ID (baseline)")
    .requiredOption("--b <id>", "Second deployment ID (comparison)")
    .option("--json", "Output as JSON")
    .action(async (opts: { a: string; b: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const result = await trpc.configDiff.query({
          deploymentIdA: opts.a,
          deploymentIdB: opts.b
        });

        if (isJson) {
          emitJsonSuccess(result);
          return;
        }

        console.log(chalk.bold("\n  Config Diff\n"));

        // Side A
        console.log(chalk.cyan("  A (baseline):"));
        console.log(`    ID:      ${result.a.id}`);
        console.log(`    Project: ${result.a.projectName}`);
        console.log(`    Env:     ${result.a.environmentName}`);
        console.log(`    Service: ${result.a.serviceName}`);
        console.log(`    Status:  ${result.a.statusLabel}`);
        console.log(`    Commit:  ${result.a.commitSha}`);
        console.log(`    Image:   ${result.a.imageTag}`);
        console.log(`    Source:  ${result.a.sourceType}`);
        console.log(`    Server:  ${result.a.targetServerName}`);
        console.log(`    Created: ${result.a.createdAt}`);
        console.log();

        // Side B
        console.log(chalk.cyan("  B (comparison):"));
        console.log(`    ID:      ${result.b.id}`);
        console.log(`    Project: ${result.b.projectName}`);
        console.log(`    Env:     ${result.b.environmentName}`);
        console.log(`    Service: ${result.b.serviceName}`);
        console.log(`    Status:  ${result.b.statusLabel}`);
        console.log(`    Commit:  ${result.b.commitSha}`);
        console.log(`    Image:   ${result.b.imageTag}`);
        console.log(`    Source:  ${result.b.sourceType}`);
        console.log(`    Server:  ${result.b.targetServerName}`);
        console.log(`    Created: ${result.b.createdAt}`);
        console.log();

        // Differences
        console.log(chalk.bold("  Changes:"));
        if (!result.summary.sameProject) console.log(chalk.yellow("    ⚠ Different projects"));
        if (!result.summary.sameEnvironment)
          console.log(chalk.yellow("    ⚠ Different environments"));
        if (!result.summary.sameService) console.log(chalk.yellow("    ⚠ Different services"));

        for (const change of result.scalarChanges) {
          console.log(
            chalk.red(
              `    ✗ ${change.key}: ${String(change.baseline)} → ${String(change.comparison)}`
            )
          );
        }

        if (result.snapshotChanges.length > 0) {
          console.log();
          console.log(chalk.dim("  Snapshot changes:"));
          for (const change of result.snapshotChanges) {
            console.log(
              `    ${chalk.yellow("•")} ${change.key}: ${JSON.stringify(change.baseline)} → ${JSON.stringify(change.comparison)}`
            );
          }
        }

        if (result.scalarChanges.length === 0 && result.snapshotChanges.length === 0) {
          console.log(chalk.green("    ✓ No significant changes"));
        }
        console.log();
      } catch (err) {
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });
}
