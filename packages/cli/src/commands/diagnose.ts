import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient } from "../trpc-client";

function str(v: unknown): string {
  return typeof v === "string" ? v : (JSON.stringify(v) ?? "");
}

export function diagnoseCommand(): Command {
  return new Command("diagnose")
    .description("Produce an agent-ready failure summary for a deployment")
    .option("--deployment <id>", "Deployment ID to diagnose")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  deploy:read

Examples:
  daoflow diagnose --deployment dep_123 --json

Example JSON shape:
  { "ok": true, "data": { "deploymentId": "dep_123", "status": "failed", "failureAnalysis": "...", "recoveryGuidance": { ... }, "steps": [...] } }
`
    )
    .action(async (opts: { deployment?: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const currentContext = getCurrentContext();
          if (!currentContext) {
            return ctx.fail("Not logged in. Run `daoflow login` first.", {
              code: "NOT_LOGGED_IN"
            });
          }

          if (!opts.deployment) {
            return ctx.fail("--deployment <id> is required.", { code: "INVALID_INPUT" });
          }

          const trpc = createClient(currentContext);
          const detail: Record<string, unknown> = await trpc.deploymentDetails.query({
            deploymentId: opts.deployment
          });

          const healthSummary = detail.healthSummary as Record<string, unknown> | null;
          const steps = detail.steps as Record<string, unknown>[] | null;

          const diagnosis = {
            deploymentId: detail.id,
            serviceName: detail.serviceName,
            projectName: detail.projectName,
            environmentName: detail.environmentName,
            status: detail.status,
            statusLabel: detail.statusLabel,
            conclusion: detail.conclusion,
            sourceType: detail.sourceType,
            targetServerName: detail.targetServerName,
            createdAt: detail.createdAt,
            finishedAt: detail.finishedAt,
            failureAnalysis: healthSummary?.failureAnalysis ?? null,
            recoveryGuidance: detail.recoveryGuidance ?? null,
            healthSummary,
            steps: steps?.map((s) => ({
              label: s.label,
              status: s.status,
              detail: s.detail,
              startedAt: s.startedAt,
              completedAt: s.completedAt ?? s.finishedAt
            }))
          };

          return ctx.success(diagnosis, {
            human: () => {
              console.log(chalk.bold("\n  Deployment Diagnosis\n"));
              const statusColor =
                detail.status === "healthy"
                  ? chalk.green
                  : detail.status === "failed"
                    ? chalk.red
                    : chalk.yellow;
              console.log(
                `  ${str(detail.serviceName)} (${str(detail.projectName)}/${str(detail.environmentName)})`
              );
              console.log(`  Status: ${statusColor(str(detail.statusLabel))}`);
              console.log(`  Server: ${str(detail.targetServerName)}`);
              console.log(`  Created: ${str(detail.createdAt)}`);
              if (detail.finishedAt) console.log(`  Finished: ${str(detail.finishedAt)}`);
              console.log();

              if (diagnosis.failureAnalysis) {
                console.log(chalk.red("  Failure Analysis:"));
                console.log(`    ${str(diagnosis.failureAnalysis)}`);
                console.log();
              }

              if (diagnosis.recoveryGuidance) {
                console.log(chalk.yellow("  Recovery Guidance:"));
                const guidance = diagnosis.recoveryGuidance as Record<string, unknown>;
                if (guidance.summary) console.log(`    ${str(guidance.summary)}`);
                const actions = guidance.actions;
                if (Array.isArray(actions)) {
                  for (const action of actions) {
                    console.log(`    - ${action}`);
                  }
                }
                console.log();
              }

              if (diagnosis.steps && Array.isArray(diagnosis.steps)) {
                console.log("  Steps:");
                for (const step of diagnosis.steps) {
                  const icon = step.status === "completed" ? chalk.green("✓") : chalk.red("✗");
                  console.log(
                    `    ${icon} ${str(step.label)}${step.detail ? chalk.dim(` — ${str(step.detail)}`) : ""}`
                  );
                }
                console.log();
              }
            }
          });
        }
      });
    });
}
