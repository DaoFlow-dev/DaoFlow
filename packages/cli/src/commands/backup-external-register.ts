import chalk from "chalk";
import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { renderBackupError } from "./backup-shared";
import {
  normalizeExternalObjectKey,
  parsePositiveInteger,
  validateSafetyFlags
} from "./backup-external-shared";

export function registerExternalArtifactRegisterCommand(external: Command): void {
  external
    .command("register")
    .description("Register an exact object as an external PostgreSQL backup artifact")
    .requiredOption("--destination <id>", "Backup destination ID")
    .requiredOption("--object-key <key>", "Exact approved-prefix object key")
    .requiredOption("--postgres-major <n>", "Expected PostgreSQL major version")
    .option("--dry-run", "Preview locally without making an API call")
    .option("-y, --yes", "Execute the registration")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  execution: backup:restore

Examples:
  daoflow backup external register --destination dest_123 --object-key database-imports/app.dump --postgres-major 17 --dry-run --json
  daoflow backup external register --destination dest_123 --object-key database-imports/app.dump --postgres-major 17 --yes

Example JSON shape:
  { "ok": true, "data": { "artifact": { "id": "xart_123", "objectKey": "database-imports/app.dump", "status": "registering" }, "workflowId": "external-import-xart_123", "nextAction": "Wait for isolated archive inspection." } }
`
    )
    .action(
      async (
        opts: {
          destination: string;
          objectKey: string;
          postgresMajor: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            let destinationId: string;
            let objectKey: string;
            let postgresMajor: number;
            try {
              destinationId = normalizeCliInput(opts.destination, "Destination ID");
              objectKey = normalizeExternalObjectKey(opts.objectKey);
              postgresMajor = parsePositiveInteger(opts.postgresMajor, "PostgreSQL major", {
                max: 99
              });
              validateSafetyFlags(opts.dryRun, opts.yes);
            } catch (error) {
              return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  destinationId,
                  objectKey,
                  postgresMajor
                },
                {
                  json: {
                    ok: true,
                    data: { dryRun: true, destinationId, objectKey, postgresMajor }
                  },
                  human: () => {
                    console.log(chalk.bold("\n  External Artifact Registration (dry-run)\n"));
                    console.log(`  Destination: ${destinationId}`);
                    console.log(`  Object key:  ${objectKey}`);
                    console.log(`  PostgreSQL:  ${postgresMajor}`);
                    console.log(chalk.dim("  No API mutation was made.\n"));
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To register external artifact ${objectKey}, add --yes`
            );

            const trpc = createClient();
            const result = await trpc.registerExternalBackupArtifact.mutate({
              destinationId,
              objectKey,
              postgresMajor
            });

            return ctx.success(result, {
              quiet: () => result.artifact.id,
              human: () => {
                console.log(
                  chalk.green(`✅ External artifact registration queued: ${result.artifact.id}`)
                );
                console.log(`  Workflow: ${result.workflowId}`);
                console.log(`  Next: ${result.nextAction}`);
              }
            });
          }
        });
      }
    );
}
