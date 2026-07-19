import { Command } from "commander";
import chalk from "chalk";

import { CommandActionError, runCommandAction } from "../command-action";
import { redactRecoveryRestoreError } from "../control-plane-recovery-restore-config";
import { executeControlPlaneRecoveryRestore } from "../control-plane-recovery-restore-execution";
import { inspectControlPlaneRecoveryRestore } from "../control-plane-recovery-restore-plan";
import type {
  ControlPlaneRecoveryRestoreInspection,
  ControlPlaneRecoveryRestorePlan
} from "../control-plane-recovery-restore-types";
import { defaultInstallDir } from "../templates";
import { renderBackupError } from "./backup-shared";

export const controlPlaneRecoveryRestoreCommandRuntime = {
  inspect: inspectControlPlaneRecoveryRestore,
  execute: executeControlPlaneRecoveryRestore
};

type RestoreOptions = {
  dir: string;
  bundle: string;
  manifest: string;
  externalSecrets: string;
  databaseName?: string;
  dryRun?: boolean;
  confirm?: string;
  yes?: boolean;
  json?: boolean;
};

export function registerControlPlaneRecoveryRestoreCommand(recovery: Command): void {
  recovery
    .command("restore")
    .description("Restore a verified recovery bundle into a clean installation")
    .option("--dir <path>", "Clean DaoFlow installation directory", defaultInstallDir())
    .requiredOption("--bundle <path>", "Local encrypted recovery bundle (.dfr)")
    .requiredOption("--manifest <path>", "Local signed recovery manifest (prefer latest.json)")
    .requiredOption("--external-secrets <path>", "Owner-only recovery secrets file")
    .option("--database-name <name>", "New PostgreSQL database name")
    .option("--dry-run", "Validate inputs and print the exact recovery plan")
    .option("--confirm <plan-hash>", "Exact SHA-256 hash returned by --dry-run")
    .option("-y, --yes", "Confirm the offline restore and switchover")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Access: local root/operator command; no running DaoFlow API or token is required.
Safety: restores only into a new database, preserves the old database and config,
and automatically restores the previous config when post-start verification fails.

Examples:
  daoflow backup recovery restore --dir /opt/daoflow --bundle ./bundle.dfr --manifest ./latest.json --external-secrets /secure/recovery.env --dry-run --json
  daoflow backup recovery restore --dir /opt/daoflow --bundle ./bundle.dfr --manifest ./latest.json --external-secrets /secure/recovery.env --confirm <plan-hash> --yes

Example JSON shapes:
  { "ok": true, "data": { "dryRun": true, "plan": { "planHash": "sha256...", "databases": { "oldDatabase": "daoflow", "newDatabase": "daoflow_recovery_bundle" } } } }
  { "ok": true, "data": { "status": "restored", "previousDatabase": "daoflow", "restoredDatabase": "daoflow_recovery_bundle", "rollback": { "databaseRetained": true, "configRetained": true } } }
  { "ok": false, "code": "PLAN_HASH_MISMATCH", "error": "The supplied recovery plan hash does not match the current plan." }
`
    )
    .action(async (opts: RestoreOptions, command: Command) => {
      await runCommandAction<unknown>({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          if (opts.dryRun && (opts.yes || opts.confirm)) {
            return ctx.fail("Use --dry-run by itself, then execute with --confirm and --yes.", {
              code: "INVALID_INPUT"
            });
          }

          let inspection: ControlPlaneRecoveryRestoreInspection | null = null;
          let cleanupHandled = false;
          try {
            inspection = await controlPlaneRecoveryRestoreCommandRuntime.inspect({
              bundlePath: opts.bundle,
              sidecarPath: opts.manifest,
              secretsPath: opts.externalSecrets,
              installDir: opts.dir,
              databaseName: opts.databaseName
            });
            const plan = inspection.plan;

            if (opts.dryRun) {
              const cleanupWarning = await cleanupRecoveryInspection(inspection);
              cleanupHandled = true;
              const data = cleanupWarning
                ? { dryRun: true, plan, warnings: [cleanupWarning] }
                : { dryRun: true, plan };
              return ctx.dryRun(data, {
                json: { ok: true, data },
                human: () => renderRestorePlan(plan, cleanupWarning ? [cleanupWarning] : [])
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              "Offline recovery changes the active control-plane database. Pass --yes to confirm."
            );
            if (!opts.confirm) {
              return ctx.fail(
                "Run --dry-run first, then pass its exact plan hash with --confirm.",
                { code: "CONFIRMATION_REQUIRED" }
              );
            }
            if (opts.confirm !== plan.planHash) {
              return ctx.fail("The supplied recovery plan hash does not match the current plan.", {
                code: "PLAN_HASH_MISMATCH"
              });
            }

            const result = await controlPlaneRecoveryRestoreCommandRuntime.execute(inspection);
            const cleanupWarning = await cleanupRecoveryInspection(inspection);
            cleanupHandled = true;
            const data = cleanupWarning ? { ...result, warnings: [cleanupWarning] } : result;
            return ctx.success(data, {
              quiet: () => result.restoredDatabase,
              human: () => renderRestoreSuccess(data)
            });
          } catch (error) {
            if (error instanceof CommandActionError) throw error;
            ctx.fail(redactRecoveryRestoreError(error, { secrets: inspection?.secrets }), {
              code: "RECOVERY_RESTORE_FAILED"
            });
          } finally {
            if (inspection && !cleanupHandled) await cleanupRecoveryInspection(inspection);
          }
        }
      });
    });
}

function renderRestorePlan(plan: ControlPlaneRecoveryRestorePlan, warnings: string[] = []): void {
  console.log(chalk.bold("\nControl-plane recovery restore plan\n"));
  console.log(`  Bundle:       ${plan.bundle.id}`);
  console.log(`  Installation: ${plan.installation.directory}`);
  console.log(`  Current DB:   ${plan.databases.oldDatabase}`);
  console.log(`  Recovery DB:  ${plan.databases.newDatabase}`);
  console.log(`  Plan hash:    ${plan.planHash}`);
  console.log(
    chalk.dim("\n  Review this output, then pass the exact hash with --confirm and --yes.\n")
  );
  for (const warning of warnings) {
    console.error(chalk.yellow(`Warning: ${warning}`));
  }
}

function renderRestoreSuccess(result: {
  restoredDatabase: string;
  previousDatabase: string;
  previousConfigPath: string;
  warnings?: string[];
}): void {
  console.log(chalk.green("\nControl-plane recovery completed and verified.\n"));
  console.log(`  Active database:   ${result.restoredDatabase}`);
  console.log(`  Rollback database: ${result.previousDatabase}`);
  console.log(`  Previous config:   ${result.previousConfigPath}\n`);
  for (const warning of result.warnings ?? []) {
    console.error(chalk.yellow(`Warning: ${warning}`));
  }
}

async function cleanupRecoveryInspection(
  inspection: ControlPlaneRecoveryRestoreInspection
): Promise<string | null> {
  try {
    await inspection.cleanup();
    return null;
  } catch {
    return `Recovery workspace cleanup failed. Remove the temporary recovery workspace manually: ${inspection.workspace}.`;
  }
}
