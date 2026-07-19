import chalk from "chalk";
import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import type { ExternalBackupArtifactsOutput } from "../trpc-contract";
import { renderBackupError } from "./backup-shared";
import {
  formatExternalBytes,
  pinnedExternalIdentity,
  renderExternalStatus,
  parsePositiveInteger
} from "./backup-external-shared";

function renderExternalArtifacts(data: ExternalBackupArtifactsOutput): void {
  console.log(chalk.bold("\n  External Backup Artifacts\n"));
  if (data.artifacts.length === 0) {
    console.log(chalk.dim("  No external artifacts registered.\n"));
    return;
  }

  for (const artifact of data.artifacts) {
    const origin = artifact.destinationName
      ? `External (${artifact.destinationName})`
      : `External (${artifact.destinationId})`;
    console.log(`  ${chalk.bold(origin)}  ${renderExternalStatus(artifact.status)}`);
    console.log(`    ID:       ${artifact.id}`);
    console.log(`    Key:      ${artifact.objectKey}`);
    console.log(
      `    Pinned:   ${pinnedExternalIdentity(artifact.objectVersion, artifact.objectEtag)}`
    );
    console.log(`    Size:     ${formatExternalBytes(artifact.sizeBytes)}`);
    console.log(`    Checksum: ${artifact.sha256 ?? "pending"}`);
    console.log();
  }
}

export function registerExternalArtifactListCommand(external: Command): void {
  external
    .command("list")
    .description("List registered external backup artifacts")
    .option("--destination <id>", "Filter by backup destination ID")
    .option("--limit <n>", "Maximum artifacts to show", "50")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  backup:read

Examples:
  daoflow backup external list
  daoflow backup external list --destination dest_123 --limit 20 --json

Example JSON shape:
  { "ok": true, "data": { "artifacts": [{ "id": "xart_123", "destinationId": "dest_123", "destinationName": "archive", "objectKey": "database-imports/app.dump", "objectVersion": "v1", "objectEtag": null, "sizeBytes": "4096", "sha256": "...", "status": "verified", "verifiedAt": "2026-07-19T12:00:00.000Z" }] } }
`
    )
    .action(
      async (opts: { destination?: string; limit: string; json?: boolean }, command: Command) => {
        await runCommandAction<ExternalBackupArtifactsOutput>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            let destinationId: string | undefined;
            let limit: number;
            try {
              destinationId = opts.destination
                ? normalizeCliInput(opts.destination, "Destination ID")
                : undefined;
              limit = parsePositiveInteger(opts.limit, "Limit", { max: 100 });
            } catch (error) {
              return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }

            const trpc = createClient();
            const data = await trpc.externalBackupArtifacts.query({
              ...(destinationId ? { destinationId } : {}),
              limit
            });

            return ctx.success(data, {
              human: () => renderExternalArtifacts(data)
            });
          }
        });
      }
    );
}
