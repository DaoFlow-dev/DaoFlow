import chalk from "chalk";
import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import type { ExternalBackupObjectsOutput } from "../trpc-contract";
import { renderBackupError } from "./backup-shared";
import { formatExternalBytes, normalizeExternalObjectPrefix } from "./backup-external-shared";

function renderDestinationFiles(data: ExternalBackupObjectsOutput): void {
  console.log(chalk.bold("\n  Approved Backup Destination Objects\n"));
  console.log(`  Destination: ${data.destination.name} (${data.destination.id})`);
  console.log(`  Approved prefix: ${data.prefix}`);

  if (data.objects.length === 0) {
    console.log(chalk.dim("  No approved-prefix objects found.\n"));
    return;
  }

  for (const object of data.objects) {
    const identity = object.versionId ?? object.etag ?? "unversioned";
    console.log(
      `  ${chalk.bold(object.key)}  ${formatExternalBytes(object.size)}  identity=${chalk.dim(identity)}  modified=${object.lastModified ?? "unknown"}`
    );
  }
  console.log("");
}

export function registerBackupDestinationFilesCommand(destination: Command): void {
  destination
    .command("files")
    .description("List objects in a destination's approved external-import prefix")
    .requiredOption("--id <destination>", "Backup destination ID")
    .option("--prefix <prefix>", "Sub-prefix within the approved import prefix")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  backup:read

Examples:
  daoflow backup destination files --id dest_123
  daoflow backup destination files --id dest_123 --prefix daily/ --json

Example JSON shape:
  { "ok": true, "data": { "destination": { "id": "dest_123", "name": "archive", "provider": "s3" }, "prefix": "database-imports/", "objects": [{ "key": "database-imports/app.dump", "name": "app.dump", "size": 4096, "lastModified": "2026-07-19T12:00:00.000Z", "etag": "etag-1", "versionId": null }] } }
`
    )
    .action(async (opts: { id: string; prefix?: string; json?: boolean }, command: Command) => {
      await runCommandAction<ExternalBackupObjectsOutput>({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          let destinationId: string;
          let prefix: string | undefined;
          try {
            destinationId = normalizeCliInput(opts.id, "Destination ID");
            prefix = normalizeOptionalCliInput(opts.prefix, "Prefix", { maxLength: 1024 });
            if (prefix) prefix = normalizeExternalObjectPrefix(prefix);
          } catch (error) {
            return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
          }

          const trpc = createClient();
          const data = await trpc.externalBackupObjects.query({
            destinationId,
            ...(prefix ? { prefix } : {})
          });

          return ctx.success(data, {
            human: () => renderDestinationFiles(data)
          });
        }
      });
    });
}
