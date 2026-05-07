import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

function parseRetention(value?: string): number | undefined {
  const normalized = normalizeOptionalCliInput(value, "Retention count");
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("Retention count must be between 1 and 100.");
  }
  return parsed;
}

export function serviceScheduleCommand(): Command {
  const schedules = new Command("schedules").description("Manage service schedules");

  schedules
    .command("list")
    .requiredOption("--service <id>", "Service ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { service: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const serviceId = normalizeCliInput(opts.service, "Service ID");
          const result = await createClient().serviceSchedules.query({ serviceId });
          return ctx.success(result, {
            human: () => {
              console.log(chalk.bold(`\n  Service schedules for ${serviceId}\n`));
              for (const schedule of result) {
                console.log(
                  `  ${schedule.id}  ${schedule.status.padEnd(8)}  ${schedule.cronExpression}  ${schedule.name}`
                );
              }
              if (result.length === 0) console.log(chalk.dim("  No schedules found."));
              console.log();
            }
          });
        }
      });
    });

  schedules
    .command("create")
    .requiredOption("--service <id>", "Service ID")
    .requiredOption("--name <name>", "Schedule name")
    .requiredOption("--command <command>", "Command to hand off to the runner")
    .requiredOption("--cron <expression>", 'Cron expression, for example "*/15 * * * *"')
    .option("--timezone <zone>", "IANA timezone", "UTC")
    .option("--retention <count>", "Run history retention count")
    .option("--no-notify-on-failure", "Disable failed-run notifications")
    .option("--dry-run", "Preview without mutating")
    .option("-y, --yes", "Confirm creation")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          service: string;
          name: string;
          command: string;
          cron: string;
          timezone?: string;
          retention?: string;
          notifyOnFailure?: boolean;
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
              serviceId: normalizeCliInput(opts.service, "Service ID"),
              name: normalizeCliInput(opts.name, "Schedule name"),
              command: normalizeCliInput(opts.command, "Schedule command", {
                allowPathTraversal: true,
                allowShellMetacharacters: true,
                maxLength: 4000
              }),
              cronExpression: normalizeCliInput(opts.cron, "Cron expression", {
                allowShellMetacharacters: true,
                maxLength: 120
              }),
              timezone: normalizeOptionalCliInput(opts.timezone, "Timezone") ?? "UTC",
              retentionCount: parseRetention(opts.retention),
              notifyOnFailure: opts.notifyOnFailure !== false
            };

            if (opts.dryRun) {
              return ctx.dryRun({ dryRun: true, action: "service.schedule.create", ...payload });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create schedule ${payload.name}. Pass --yes to confirm.`
            );
            const result = await createClient().createServiceSchedule.mutate(payload);
            return ctx.success(result, {
              quiet: () => result.id,
              human: () => console.log(chalk.green(`✓ Created schedule ${result.id}`))
            });
          }
        });
      }
    );

  for (const action of ["pause", "resume", "run", "delete"] as const) {
    schedules
      .command(action)
      .requiredOption("--schedule <id>", "Schedule ID")
      .option("--dry-run", "Preview without mutating")
      .option("-y, --yes", `Confirm ${action}`)
      .option("--json", "Output as JSON")
      .action(
        async (
          opts: { schedule: string; dryRun?: boolean; yes?: boolean; json?: boolean },
          command: Command
        ) => {
          await runCommandAction<unknown>({
            command,
            json: opts.json,
            action: async (ctx) => {
              const scheduleId = normalizeCliInput(opts.schedule, "Schedule ID");
              if (opts.dryRun) {
                return ctx.dryRun({
                  dryRun: true,
                  action: `service.schedule.${action}`,
                  scheduleId
                });
              }
              ctx.requireConfirmation(
                opts.yes === true,
                `${action} schedule ${scheduleId}. Pass --yes to confirm.`
              );
              const trpc = createClient();
              const result =
                action === "run"
                  ? await trpc.runServiceScheduleNow.mutate({ scheduleId })
                  : action === "delete"
                    ? await trpc.deleteServiceSchedule.mutate({ scheduleId })
                    : await trpc.setServiceScheduleState.mutate({ scheduleId, state: action });
              return ctx.success(result, {
                human: () => console.log(chalk.green(`✓ ${action} completed for ${scheduleId}`))
              });
            }
          });
        }
      );
  }

  schedules
    .command("runs")
    .requiredOption("--schedule <id>", "Schedule ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { schedule: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const scheduleId = normalizeCliInput(opts.schedule, "Schedule ID");
          const result = await createClient().serviceScheduleRuns.query({ scheduleId });
          return ctx.success(result, {
            human: () => {
              console.log(chalk.bold(`\n  Schedule runs for ${scheduleId}\n`));
              for (const run of result.runs) {
                console.log(`  ${run.id}  ${run.status.padEnd(10)}  ${run.createdAt}`);
              }
              if (result.runs.length === 0) console.log(chalk.dim("  No runs found."));
              console.log();
            }
          });
        }
      });
    });

  return schedules;
}
