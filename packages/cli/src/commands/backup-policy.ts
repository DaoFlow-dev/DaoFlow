import type { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient } from "../trpc-client";
import type { BackupPolicyMutationOutput } from "../trpc-contract";

const BACKUP_POLICY_CREATE_HELP_TEXT = [
  "",
  "Required scope:",
  "  backup:run",
  "",
  "Examples:",
  "  daoflow backup policy create --name nightly-db --volume-id vol_123 --destination-id dest_456 --retention-days 14 --yes",
  "  daoflow backup policy create --name uploads --volume-id vol_123 --schedule '0 2 * * *' --dry-run --json",
  "",
  "Example JSON shapes:",
  '  dry-run: { "ok": true, "data": { "dryRun": true, "name": "nightly-db", "volumeId": "vol_123" } }',
  '  execute: { "ok": true, "data": { "policy": { "id": "bpol_123", "name": "nightly-db", "volumeId": "vol_123" } } }'
].join("\n");

function trimOrUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function renderPolicyHuman(action: "created" | "updated", policy: BackupPolicyMutationOutput) {
  console.log(chalk.green(`✓ Backup policy ${action}: ${policy.name} (${policy.id})`));
  console.log(
    chalk.dim(
      `  Volume ${policy.volumeName} · ${policy.backupType} · retain ${policy.retentionDays} days`
    )
  );
  if (policy.destinationName) {
    console.log(chalk.dim(`  Destination ${policy.destinationName}`));
  }
  if (policy.schedule) {
    console.log(chalk.dim(`  Schedule ${policy.schedule}`));
  }
  console.log();
}

export function registerBackupPolicySubcommands(backup: Command) {
  const policy = backup.command("policy").description("Create, update, and delete backup policies");

  policy
    .command("create")
    .description("Create a backup policy for a registered volume")
    .requiredOption("--name <name>", "Policy name")
    .requiredOption("--volume-id <id>", "Volume ID")
    .option("--destination-id <id>", "Backup destination ID")
    .option("--backup-type <type>", "Backup type (volume or database)", "volume")
    .option("--database-engine <engine>", "Database engine hint")
    .option("--turn-off", "Stop the container before backup")
    .option("--schedule <cron>", "Cron schedule for Temporal-backed execution")
    .option("--retention-days <n>", "Retention window in days", parsePositiveInt, 30)
    .option("--retention-daily <n>", "Daily retention count", parseNonNegativeInt)
    .option("--retention-weekly <n>", "Weekly retention count", parseNonNegativeInt)
    .option("--retention-monthly <n>", "Monthly retention count", parseNonNegativeInt)
    .option("--max-backups <n>", "Hard backup count cap", parsePositiveInt)
    .option("--status <status>", "Policy status (active or paused)", "active")
    .option("--dry-run", "Preview the policy payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText("after", BACKUP_POLICY_CREATE_HELP_TEXT)
    .action(
      async (
        opts: {
          name: string;
          volumeId: string;
          destinationId?: string;
          backupType: "volume" | "database";
          databaseEngine?: "postgres" | "mysql" | "mariadb" | "mongo";
          turnOff?: boolean;
          schedule?: string;
          retentionDays: number;
          retentionDaily?: number;
          retentionWeekly?: number;
          retentionMonthly?: number;
          maxBackups?: number;
          status: "active" | "paused";
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const payload = {
              name: opts.name.trim(),
              volumeId: opts.volumeId.trim(),
              destinationId: trimOrUndefined(opts.destinationId),
              backupType: opts.backupType,
              databaseEngine: opts.databaseEngine,
              turnOff: opts.turnOff ?? false,
              schedule: trimOrUndefined(opts.schedule),
              retentionDays: opts.retentionDays,
              retentionDaily: opts.retentionDaily,
              retentionWeekly: opts.retentionWeekly,
              retentionMonthly: opts.retentionMonthly,
              maxBackups: opts.maxBackups,
              status: opts.status
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  json: { ok: true, data: { dryRun: true, ...payload } }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create backup policy ${payload.name}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const created = await trpc.createBackupPolicy.mutate(payload);

            return ctx.success(
              {
                policy: created
              },
              {
                human: () => renderPolicyHuman("created", created)
              }
            );
          }
        });
      }
    );

  policy
    .command("update")
    .description("Update a backup policy")
    .requiredOption("--policy-id <id>", "Policy ID")
    .option("--name <name>", "Policy name")
    .option("--volume-id <id>", "Volume ID")
    .option("--destination-id <id>", "Backup destination ID")
    .option("--clear-destination", "Clear any linked backup destination")
    .option("--backup-type <type>", "Backup type (volume or database)")
    .option("--database-engine <engine>", "Database engine hint")
    .option("--turn-off", "Stop the container before backup")
    .option("--turn-on", "Clear the stop-container behavior")
    .option("--schedule <cron>", "Cron schedule for Temporal-backed execution")
    .option("--clear-schedule", "Remove the current schedule")
    .option("--retention-days <n>", "Retention window in days", parsePositiveInt)
    .option("--retention-daily <n>", "Daily retention count", parseNonNegativeInt)
    .option("--retention-weekly <n>", "Weekly retention count", parseNonNegativeInt)
    .option("--retention-monthly <n>", "Monthly retention count", parseNonNegativeInt)
    .option("--max-backups <n>", "Hard backup count cap", parsePositiveInt)
    .option("--status <status>", "Policy status (active or paused)")
    .option("--dry-run", "Preview the update payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          policyId: string;
          name?: string;
          volumeId?: string;
          destinationId?: string;
          clearDestination?: boolean;
          backupType?: "volume" | "database";
          databaseEngine?: "postgres" | "mysql" | "mariadb" | "mongo";
          turnOff?: boolean;
          turnOn?: boolean;
          schedule?: string;
          clearSchedule?: boolean;
          retentionDays?: number;
          retentionDaily?: number;
          retentionWeekly?: number;
          retentionMonthly?: number;
          maxBackups?: number;
          status?: "active" | "paused";
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const payload = {
              policyId: opts.policyId.trim(),
              name: trimOrUndefined(opts.name),
              volumeId: trimOrUndefined(opts.volumeId),
              destinationId: opts.clearDestination ? "" : trimOrUndefined(opts.destinationId),
              backupType: opts.backupType,
              databaseEngine: opts.databaseEngine,
              turnOff: opts.turnOff ? true : opts.turnOn ? false : undefined,
              schedule: opts.clearSchedule ? "" : trimOrUndefined(opts.schedule),
              retentionDays: opts.retentionDays,
              retentionDaily: opts.retentionDaily,
              retentionWeekly: opts.retentionWeekly,
              retentionMonthly: opts.retentionMonthly,
              maxBackups: opts.maxBackups,
              status: opts.status
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  json: { ok: true, data: { dryRun: true, ...payload } }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Update backup policy ${payload.policyId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const updated = await trpc.updateBackupPolicy.mutate(payload);

            return ctx.success(
              {
                policy: updated
              },
              {
                human: () => renderPolicyHuman("updated", updated)
              }
            );
          }
        });
      }
    );

  policy
    .command("delete")
    .description("Delete a backup policy")
    .requiredOption("--policy-id <id>", "Policy ID")
    .option("--dry-run", "Preview the delete payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { policyId: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const policyId = opts.policyId.trim();

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  action: "backup-policy.delete",
                  policyId
                },
                {
                  json: {
                    ok: true,
                    data: {
                      dryRun: true,
                      action: "backup-policy.delete",
                      policyId
                    }
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Delete backup policy ${policyId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const result = await trpc.deleteBackupPolicy.mutate({ policyId });

            return ctx.success(result, {
              human: () => {
                console.log(chalk.green(`✓ Deleted backup policy ${policyId}`));
                console.log();
              }
            });
          }
        });
      }
    );
}
