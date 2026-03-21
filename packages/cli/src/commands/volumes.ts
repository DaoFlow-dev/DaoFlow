import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient } from "../trpc-client";
import type { PersistentVolumeRegistryOutput, VolumeMutationOutput } from "../trpc-contract";

const VOLUME_REGISTER_HELP_TEXT = [
  "",
  "Required scope:",
  "  volumes:write",
  "",
  "Examples:",
  "  daoflow volumes register --name postgres-data --server-id srv_123 --mount-path /var/lib/postgresql/data --yes",
  "  daoflow volumes register --name uploads --server-id srv_123 --service-id svc_456 --dry-run --json",
  "",
  "Example JSON shapes:",
  '  dry-run: { "ok": true, "data": { "dryRun": true, "name": "postgres-data", "serverId": "srv_123", "mountPath": "/var/lib/postgresql/data" } }',
  '  execute: { "ok": true, "data": { "volume": { "id": "vol_123", "name": "postgres-data", "serverId": "srv_123" } } }'
].join("\n");

function parseNonNegativeInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function parseVolumeStatus(value: string): "active" | "inactive" | "paused" {
  if (value === "active" || value === "inactive" || value === "paused") {
    return value;
  }

  throw new Error(`Unsupported volume status: ${value}`);
}

function trimOrUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function renderVolumeListHuman(data: PersistentVolumeRegistryOutput) {
  console.log(chalk.bold("\n  Persistent Volumes\n"));
  console.log(`  Total:      ${data.summary.totalVolumes}`);
  console.log(`  Protected:  ${data.summary.protectedVolumes}`);
  console.log(`  Attention:  ${data.summary.attentionVolumes}`);

  if (data.volumes.length === 0) {
    console.log("\n  No registered volumes.\n");
    return;
  }

  console.log();
  for (const volume of data.volumes) {
    console.log(`  ${chalk.cyan(volume.volumeName)}  (${volume.id})`);
    console.log(
      chalk.dim(
        `    ${volume.targetServerName} · ${volume.mountPath} · ${volume.driver} · ${volume.backupCoverage}`
      )
    );
    if (volume.serviceName) {
      console.log(
        chalk.dim(`    ${volume.projectName}/${volume.environmentName}/${volume.serviceName}`)
      );
    }
  }
  console.log();
}

function renderVolumeMutationHuman(action: "registered" | "updated", volume: VolumeMutationOutput) {
  console.log(chalk.green(`✓ Volume ${action}: ${volume.name} (${volume.id})`));
  console.log(
    chalk.dim(`  ${volume.serverName} · ${volume.mountPath} · ${volume.driver} · ${volume.status}`)
  );
  if (volume.serviceName) {
    console.log(
      chalk.dim(
        `  Linked to ${volume.projectName ?? "—"}/${volume.environmentName ?? "—"}/${volume.serviceName}`
      )
    );
  }
  console.log();
}

export function volumesCommand(): Command {
  const cmd = new Command("volumes").description("Register and manage persistent volume metadata");

  cmd
    .command("list")
    .description("List registered persistent volumes")
    .option("--limit <n>", "Max volumes to show", "24")
    .option("--json", "Output as JSON")
    .action(async (opts: { limit: string; json?: boolean }, command: Command) => {
      await runCommandAction<unknown>({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const data = await trpc.persistentVolumes.query({
            limit: Number.parseInt(opts.limit, 10)
          });

          return ctx.success(data, {
            human: () => renderVolumeListHuman(data)
          });
        }
      });
    });

  cmd
    .command("register")
    .description("Register a persistent volume in the control plane")
    .requiredOption("--name <name>", "Volume name")
    .requiredOption("--server-id <id>", "Target server ID")
    .requiredOption("--mount-path <path>", "Mount path on the server")
    .option("--service-id <id>", "Linked service ID")
    .option("--driver <name>", "Volume driver", "local")
    .option("--size-bytes <n>", "Attached size in bytes", parseNonNegativeInt)
    .option("--status <status>", "Volume status", parseVolumeStatus, "active")
    .option("--dry-run", "Preview the registration payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText("after", VOLUME_REGISTER_HELP_TEXT)
    .action(
      async (
        opts: {
          name: string;
          serverId: string;
          mountPath: string;
          serviceId?: string;
          driver: string;
          sizeBytes?: number;
          status: "active" | "inactive" | "paused";
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
              serverId: opts.serverId.trim(),
              mountPath: opts.mountPath.trim(),
              serviceId: trimOrUndefined(opts.serviceId),
              driver: opts.driver.trim(),
              sizeBytes: opts.sizeBytes,
              status: opts.status
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  json: { ok: true, data: { dryRun: true, ...payload } },
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: register volume ${payload.name}\n`));
                    console.log(`  Server:      ${payload.serverId}`);
                    console.log(`  Mount path:  ${payload.mountPath}`);
                    console.log(`  Driver:      ${payload.driver}`);
                    console.log(`  Service:     ${payload.serviceId ?? "unlinked"}`);
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Register volume ${payload.name} on server ${payload.serverId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const volume = await trpc.createVolume.mutate(payload);

            return ctx.success(
              {
                volume
              },
              {
                human: () => renderVolumeMutationHuman("registered", volume)
              }
            );
          }
        });
      }
    );

  cmd
    .command("update")
    .description("Update a registered volume")
    .requiredOption("--volume-id <id>", "Volume ID")
    .option("--name <name>", "Volume name")
    .option("--server-id <id>", "Target server ID")
    .option("--mount-path <path>", "Mount path on the server")
    .option("--service-id <id>", "Linked service ID")
    .option("--detach-service", "Clear any linked service")
    .option("--driver <name>", "Volume driver")
    .option("--size-bytes <n>", "Attached size in bytes", parseNonNegativeInt)
    .option("--status <status>", "Volume status", parseVolumeStatus)
    .option("--dry-run", "Preview the update payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          volumeId: string;
          name?: string;
          serverId?: string;
          mountPath?: string;
          serviceId?: string;
          detachService?: boolean;
          driver?: string;
          sizeBytes?: number;
          status?: "active" | "inactive" | "paused";
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
              volumeId: opts.volumeId.trim(),
              name: trimOrUndefined(opts.name),
              serverId: trimOrUndefined(opts.serverId),
              mountPath: trimOrUndefined(opts.mountPath),
              serviceId: opts.detachService ? "" : trimOrUndefined(opts.serviceId),
              driver: trimOrUndefined(opts.driver),
              sizeBytes: opts.sizeBytes,
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
              `Update volume ${payload.volumeId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const volume = await trpc.updateVolume.mutate(payload);

            return ctx.success(
              {
                volume
              },
              {
                human: () => renderVolumeMutationHuman("updated", volume)
              }
            );
          }
        });
      }
    );

  cmd
    .command("delete")
    .description("Delete a registered volume")
    .requiredOption("--volume-id <id>", "Volume ID")
    .option("--dry-run", "Preview the delete payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { volumeId: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const volumeId = opts.volumeId.trim();

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  action: "volume.delete",
                  volumeId
                },
                {
                  json: {
                    ok: true,
                    data: {
                      dryRun: true,
                      action: "volume.delete",
                      volumeId
                    }
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Delete volume ${volumeId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const result = await trpc.deleteVolume.mutate({ volumeId });

            return ctx.success(result, {
              human: () => {
                console.log(chalk.green(`✓ Deleted volume ${volumeId}`));
                console.log();
              }
            });
          }
        });
      }
    );

  return cmd;
}
