import { Command } from "commander";
import { readFileSync } from "node:fs";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { certificateAssetsCommand } from "./access-asset-certificates";

function readSecretFile(path: string | undefined, inline: string | undefined, label: string) {
  if (path && inline) {
    throw new Error(`Use either --${label}-file or --${label}, not both.`);
  }
  if (path) {
    return readFileSync(
      normalizeCliInput(path, `${label} file`, { allowPathTraversal: true }),
      "utf8"
    ).trim();
  }
  return inline?.trim();
}

function requireSecret(
  value: string | undefined,
  ctx: { fail(message: string, options?: { code?: string }): never }
) {
  if (!value) {
    ctx.fail("Missing --private-key or --private-key-file.", { code: "INVALID_INPUT" });
  }
  return value;
}

export function accessAssetsCommand(): Command {
  const access = new Command("access-assets").description("Manage SSH key and certificate assets");
  const sshKeys = new Command("ssh-key").description("Manage reusable SSH keys");

  sshKeys
    .command("list")
    .description("List managed SSH keys")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const keys = await createClient().managedSshKeys.query();
          return ctx.success(
            { keys },
            {
              human: () => {
                console.log(chalk.bold("\n  Managed SSH Keys\n"));
                if (keys.length === 0) console.log(chalk.dim("  No managed SSH keys registered."));
                for (const key of keys) {
                  console.log(`  ${chalk.cyan(key.name)}  ${chalk.dim(key.id)}`);
                  console.log(chalk.dim(`    ${key.keyType} · ${key.status} · ${key.fingerprint}`));
                }
                console.log();
              }
            }
          );
        }
      });
    });

  sshKeys
    .command("create")
    .description("Create a managed SSH key")
    .requiredOption("--name <name>", "Key display name")
    .option("--username <user>", "Default SSH user")
    .option("--private-key <pem>", "Inline private key")
    .option("--private-key-file <path>", "Private key file")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          name: string;
          username?: string;
          privateKey?: string;
          privateKeyFile?: string;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            let privateKey: string | undefined;
            try {
              privateKey = readSecretFile(opts.privateKeyFile, opts.privateKey, "private-key");
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }
            const privateKeyMaterial = requireSecret(privateKey, ctx);
            const name = normalizeCliInput(opts.name, "SSH key name");
            ctx.requireConfirmation(
              opts.yes === true,
              `Create managed SSH key ${name}. Pass --yes to confirm.`
            );
            const key = await createClient().createManagedSshKey.mutate({
              name,
              username: normalizeOptionalCliInput(opts.username, "SSH username", {
                allowPathTraversal: true
              }),
              privateKey: privateKeyMaterial
            });
            return ctx.success({ key }, { quiet: () => key.id });
          }
        });
      }
    );

  sshKeys
    .command("rotate")
    .description("Rotate managed SSH key material")
    .requiredOption("--key-id <id>", "Managed SSH key ID")
    .option("--private-key <pem>", "Inline private key")
    .option("--private-key-file <path>", "Private key file")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          keyId: string;
          privateKey?: string;
          privateKeyFile?: string;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            let privateKey: string | undefined;
            try {
              privateKey = readSecretFile(opts.privateKeyFile, opts.privateKey, "private-key");
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }
            const privateKeyMaterial = requireSecret(privateKey, ctx);
            ctx.requireConfirmation(
              opts.yes === true,
              `Rotate managed SSH key ${opts.keyId}. Pass --yes to confirm.`
            );
            const key = await createClient().rotateManagedSshKey.mutate({
              keyId: opts.keyId,
              privateKey: privateKeyMaterial
            });
            return ctx.success({ key });
          }
        });
      }
    );

  sshKeys
    .command("attach")
    .description("Attach a managed SSH key to a server")
    .requiredOption("--key-id <id>", "Managed SSH key ID")
    .requiredOption("--server-id <id>", "Server ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { keyId: string; serverId: string; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Attach SSH key ${opts.keyId} to server ${opts.serverId}. Pass --yes to confirm.`
            );
            const result = await createClient().attachManagedSshKeyToServer.mutate({
              keyId: opts.keyId,
              serverId: opts.serverId
            });
            return ctx.success(result);
          }
        });
      }
    );

  sshKeys
    .command("delete")
    .description("Delete a managed SSH key")
    .requiredOption("--key-id <id>", "Managed SSH key ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts: { keyId: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          ctx.requireConfirmation(
            opts.yes === true,
            `Delete managed SSH key ${opts.keyId}. Pass --yes to confirm.`
          );
          const result = await createClient().deleteManagedSshKey.mutate({ keyId: opts.keyId });
          return ctx.success(result);
        }
      });
    });

  sshKeys
    .command("detach")
    .description("Detach a managed SSH key from a server")
    .requiredOption("--server-id <id>", "Server ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts: { serverId: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          ctx.requireConfirmation(
            opts.yes === true,
            `Detach managed SSH key from server ${opts.serverId}. Pass --yes to confirm.`
          );
          const result = await createClient().detachManagedSshKeyFromServer.mutate({
            serverId: opts.serverId
          });
          return ctx.success(result);
        }
      });
    });

  access.addCommand(sshKeys);
  access.addCommand(certificateAssetsCommand());
  return access;
}
