import { Command } from "commander";
import chalk from "chalk";
import { managedDatabaseKinds, type ManagedDatabaseKind } from "@daoflow/shared";
import { runCommandAction } from "../command-action";
import {
  normalizeCliInput,
  normalizeOptionalCliInput,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient } from "../trpc-client";
import {
  databaseNotFound,
  readDatabaseSecret,
  renderDatabaseDetails
} from "./database-command-helpers";

function isKind(value: string): value is ManagedDatabaseKind {
  return managedDatabaseKinds.includes(value as ManagedDatabaseKind);
}

export function databasesCommand(): Command {
  const databases = new Command("databases").description("Manage first-class database services");

  databases
    .command("list")
    .option("--limit <n>", "Maximum records to return")
    .option("--json", "Output as JSON")
    .description("List managed database services")
    .action(async (opts: { limit?: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      await withResolvedCommandRequestOptions(command, async () => {
        const trpc = createClient();
        const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
        const rows = await trpc.managedDatabases.query({ limit });
        if (isJson) {
          console.log(JSON.stringify({ ok: true, data: { databases: rows } }));
          return;
        }

        console.log(chalk.bold("\n  Managed databases\n"));
        if (rows.length === 0) {
          console.log(chalk.dim("  No managed databases found.\n"));
          return;
        }
        for (const row of rows) {
          console.log(
            `  ${chalk.cyan(row.database.label)} ${row.serviceName} ${chalk.dim(row.database.connectionUriMasked)}`
          );
        }
        console.log();
      });
    });

  databases
    .command("show")
    .requiredOption("--service <id>", "Managed database service ID")
    .option("--json", "Output as JSON")
    .description("Show managed database connection, volume, and backup metadata")
    .action(async (opts: { service: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const serviceId = normalizeCliInput(opts.service, "Service ID");
          const trpc = createClient();
          const service = await trpc.serviceDetails.query({ serviceId });
          if (!service.managedDatabase) {
            return ctx.fail(databaseNotFound(serviceId), { code: "INVALID_INPUT" });
          }
          return ctx.success(
            { service, database: service.managedDatabase },
            {
              human: () =>
                renderDatabaseDetails({
                  serviceName: service.name,
                  serviceId: service.id,
                  database: service.managedDatabase!
                })
            }
          );
        }
      });
    });

  databases
    .command("create")
    .requiredOption("--kind <kind>", "Database kind: postgres|mysql|mariadb|mongo|redis")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--environment <name>", "Environment name")
    .requiredOption("--server <id>", "Target server ID")
    .option("--name <name>", "Service name")
    .option("--database <name>", "Database name")
    .option("--user <name>", "Database user")
    .option("--password <value>", "Database password")
    .option("--password-env <name>", "Read database password from an env var")
    .option("--password-file <path>", "Read database password from a file")
    .option("--root-password <value>", "Root password for engines that need one")
    .option("--root-password-env <name>", "Read root password from an env var")
    .option("--root-password-file <path>", "Read root password from a file")
    .option("--port <port>", "Published host port")
    .option("--dry-run", "Preview the request without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Create and deploy a managed database service")
    .action(
      async (
        opts: {
          kind: string;
          project: string;
          environment: string;
          server: string;
          name?: string;
          database?: string;
          user?: string;
          password?: string;
          passwordEnv?: string;
          passwordFile?: string;
          rootPassword?: string;
          rootPasswordEnv?: string;
          rootPasswordFile?: string;
          port?: string;
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
            const kind = normalizeCliInput(opts.kind, "Database kind");
            if (!isKind(kind)) {
              return ctx.fail(`Database kind must be one of: ${managedDatabaseKinds.join(", ")}.`, {
                code: "INVALID_INPUT"
              });
            }
            const payload = {
              kind,
              projectId: normalizeCliInput(opts.project, "Project ID"),
              environmentName: normalizeCliInput(opts.environment, "Environment name"),
              serverId: normalizeCliInput(opts.server, "Server ID"),
              name: normalizeOptionalCliInput(opts.name, "Service name", { maxLength: 80 }),
              databaseName: normalizeOptionalCliInput(opts.database, "Database name", {
                maxLength: 80
              }),
              username: normalizeOptionalCliInput(opts.user, "Database user", { maxLength: 80 }),
              password: readDatabaseSecret(
                { value: opts.password, env: opts.passwordEnv, file: opts.passwordFile },
                "Database password"
              ),
              rootPassword: readDatabaseSecret(
                {
                  value: opts.rootPassword,
                  env: opts.rootPasswordEnv,
                  file: opts.rootPasswordFile
                },
                "Root password"
              ),
              port: normalizeOptionalCliInput(opts.port, "Port", { maxLength: 5 })
            };
            const dryRunPayload = { ...payload, password: "[secret]", rootPassword: "[secret]" };

            if (opts.dryRun) {
              return ctx.dryRun({ dryRun: true, ...dryRunPayload });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create ${kind} database ${payload.name ?? kind} on ${payload.serverId}. Pass --yes to confirm.`
            );
            const trpc = createClient();
            const result = await trpc.createManagedDatabase.mutate(payload);
            return ctx.success(result, {
              quiet: () => result.service.id,
              human: () => {
                console.log(chalk.green(`✓ Queued ${result.database.label} database`));
                console.log(chalk.dim(`  Service:    ${result.service.id}`));
                console.log(chalk.dim(`  Deployment: ${result.deployment.id}`));
                console.log(chalk.dim(`  URI:        ${result.database.connectionUriMasked}`));
                console.log();
              }
            });
          }
        });
      }
    );

  for (const action of ["start", "restart", "stop"] as const) {
    databases
      .command(action)
      .requiredOption("--service <id>", "Managed database service ID")
      .option("--dry-run", `Preview the ${action} request without mutating`)
      .option("-y, --yes", "Skip confirmation prompt")
      .option("--json", "Output as JSON")
      .description(`${action[0]?.toUpperCase()}${action.slice(1)} a managed database service`)
      .action(
        async (
          opts: { service: string; dryRun?: boolean; yes?: boolean; json?: boolean },
          command: Command
        ) => {
          await runCommandAction<unknown>({
            command,
            json: opts.json,
            action: async (ctx) => {
              const serviceId = normalizeCliInput(opts.service, "Service ID");
              if (opts.dryRun) {
                return ctx.dryRun({ dryRun: true, serviceId, action });
              }
              ctx.requireConfirmation(
                opts.yes === true,
                `${action} managed database ${serviceId}. Pass --yes to confirm.`
              );
              const trpc = createClient();
              const result = await trpc.setManagedDatabaseState.mutate({ serviceId, action });
              return ctx.success(result, {
                human: () => {
                  console.log(chalk.green(`✓ Queued ${action} for managed database ${serviceId}`));
                  console.log(chalk.dim(`  Deployment: ${result.deployment.id}`));
                  console.log();
                }
              });
            }
          });
        }
      );
  }

  databases
    .command("delete")
    .requiredOption("--service <id>", "Managed database service ID")
    .option("--dry-run", "Preview the delete request without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Delete a managed database service record")
    .action(
      async (
        opts: { service: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const serviceId = normalizeCliInput(opts.service, "Service ID");
            if (opts.dryRun) {
              return ctx.dryRun({ dryRun: true, serviceId, action: "delete" });
            }
            ctx.requireConfirmation(
              opts.yes === true,
              `Delete managed database ${serviceId}. Pass --yes to confirm.`
            );
            const trpc = createClient();
            const result = await trpc.deleteManagedDatabase.mutate({ serviceId });
            return ctx.success(result, {
              human: () => {
                console.log(chalk.green(`✓ Deleted managed database ${serviceId}`));
                console.log();
              }
            });
          }
        });
      }
    );

  return databases;
}
