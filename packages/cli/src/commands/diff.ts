/**
 * diff.ts — Compare two deployments (desired vs actual state).
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   diff → read lane, deploy:read
 *
 * Supports:
 *   daoflow diff --a <deploymentId> --b <deploymentId> [--json]
 */

import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare two deployments or config states")
    .requiredOption("--a <id>", "First deployment ID (baseline)")
    .requiredOption("--b <id>", "Second deployment ID (comparison)")
    .option("--json", "Output as JSON")
    .action(async (opts: { a: string; b: string; json?: boolean }) => {
      try {
        const trpc = createClient();
        const result = await trpc.deploymentDiff.query({
          deploymentIdA: opts.a,
          deploymentIdB: opts.b
        });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, diff: result }));
          return;
        }

        console.log(chalk.bold("\n  Deployment Diff\n"));

        // Side A
        console.log(chalk.cyan("  A (baseline):"));
        console.log(`    ID:      ${result.a.id}`);
        console.log(`    Service: ${result.a.serviceName}`);
        console.log(`    Status:  ${result.a.status}`);
        console.log(`    Commit:  ${result.a.commitSha}`);
        console.log(`    Image:   ${result.a.imageTag}`);
        console.log(`    Source:  ${result.a.sourceType}`);
        console.log(`    Created: ${result.a.createdAt}`);
        console.log();

        // Side B
        console.log(chalk.cyan("  B (comparison):"));
        console.log(`    ID:      ${result.b.id}`);
        console.log(`    Service: ${result.b.serviceName}`);
        console.log(`    Status:  ${result.b.status}`);
        console.log(`    Commit:  ${result.b.commitSha}`);
        console.log(`    Image:   ${result.b.imageTag}`);
        console.log(`    Source:  ${result.b.sourceType}`);
        console.log(`    Created: ${result.b.createdAt}`);
        console.log();

        // Differences
        console.log(chalk.bold("  Changes:"));
        const d = result.diffs;
        if (!d.sameService) console.log(chalk.yellow("    ⚠ Different services"));
        if (d.commitChanged)
          console.log(
            chalk.red(`    ✗ Commit changed: ${result.a.commitSha} → ${result.b.commitSha}`)
          );
        if (d.imageChanged)
          console.log(
            chalk.red(`    ✗ Image changed: ${result.a.imageTag} → ${result.b.imageTag}`)
          );
        if (d.sourceTypeChanged)
          console.log(
            chalk.yellow(
              `    ⚠ Source type changed: ${result.a.sourceType} → ${result.b.sourceType}`
            )
          );
        if (d.statusChanged)
          console.log(
            chalk.yellow(`    ⚠ Status changed: ${result.a.status} → ${result.b.status}`)
          );
        if (!d.commitChanged && !d.imageChanged && !d.sourceTypeChanged && !d.statusChanged) {
          console.log(chalk.green("    ✓ No significant changes"));
        }
        console.log();
      } catch (err) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Unknown error",
              code: "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : err}`));
        }
        process.exit(1);
      }
    });
}
