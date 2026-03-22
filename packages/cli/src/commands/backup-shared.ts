import chalk from "chalk";
import type { CommandActionContext, CommandActionError } from "../command-action";
import { emitJsonError, emitJsonSuccess } from "../command-helpers";
import type { BackupRestorePlanOutput } from "../trpc-contract";

export function renderBackupError(error: CommandActionError, ctx: { isJson: boolean }): void {
  if (ctx.isJson) {
    emitJsonError(error.message, error.code, error.extra);
    return;
  }

  if (error.code === "CONFIRMATION_REQUIRED") {
    console.error(error.humanMessage ?? error.message);
    return;
  }

  console.error(chalk.red(error.humanMessage ?? error.message));
}

export function emitBackupDryRunResult<T>(ctx: CommandActionContext, data: T) {
  return ctx.complete({
    exitCode: 3,
    json: { ok: true, data },
    human: () => {
      emitJsonSuccess(data);
    }
  });
}

export function renderBackupRestorePlan(plan: BackupRestorePlanOutput): void {
  console.log(chalk.bold("\n  Backup Restore Plan (dry-run)\n"));
  console.log(`  Backup run: ${plan.backupRun.id}`);
  console.log(`  Service:    ${plan.backupRun.serviceName}@${plan.backupRun.environmentName}`);
  console.log(`  Artifact:   ${plan.backupRun.artifactPath}`);
  console.log(`  Target:     ${plan.target.path}`);
  console.log(`  Server:     ${plan.target.destinationServerName}`);
  console.log(
    `  Verified:   ${plan.backupRun.verifiedAt ? plan.backupRun.verifiedAt : "not yet test-restored"}`
  );
  console.log();
  console.log(chalk.dim("  Preflight checks:"));
  for (const check of plan.preflightChecks) {
    const marker =
      check.status === "ok"
        ? chalk.green("✓")
        : check.status === "warn"
          ? chalk.yellow("!")
          : chalk.red("✗");
    console.log(`    ${marker} ${check.detail}`);
  }
  console.log();
  console.log(chalk.dim("  Steps:"));
  plan.steps.forEach((step, index) => {
    console.log(`    ${chalk.green(`${index + 1}.`)} ${step}`);
  });
  console.log();
  console.log(
    chalk.dim(
      `  Optional approval path: ${plan.approvalRequest.procedure} (${plan.approvalRequest.requiredScope})`
    )
  );
}
