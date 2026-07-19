import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { renderBackupError } from "./backup-shared";
import {
  getRecoveryBundleId,
  renderRecoveryDetails,
  renderRecoveryList,
  safePayload
} from "./control-plane-recovery-output";
import { registerControlPlaneRecoveryRestoreCommand } from "./control-plane-recovery-restore";

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }
  return limit;
}

export function registerControlPlaneRecoveryCommands(backup: Command): void {
  const recovery = backup
    .command("recovery")
    .description("Plan and verify control-plane recovery bundles")
    .addHelpText(
      "after",
      `
Required scopes:
  plan, list, inspect, download-metadata: backup:read
  run: backup:run
  restore: local offline command; no API scope

Examples:
  daoflow backup recovery plan --destination dest_123 --json
  daoflow backup recovery run --destination dest_123 --dry-run --json
  daoflow backup recovery run --destination dest_123 --yes
  daoflow backup recovery list --json
  daoflow backup recovery inspect --bundle rb_123 --json
  daoflow backup recovery download-metadata --bundle rb_123 --json
  daoflow backup recovery restore --bundle ./bundle.dfr --manifest ./latest.json --external-secrets /secure/recovery.env --dry-run --json
`
    );

  registerControlPlaneRecoveryRestoreCommand(recovery);

  recovery
    .command("plan")
    .description("Check recovery readiness without creating a bundle")
    .requiredOption("--destination <id>", "Existing backup destination ID")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope: backup:read
Example: daoflow backup recovery plan --destination dest_123 --json
Example JSON shape: { "ok": true, "data": { "isReady": true, "keyFingerprint": "sha256:...", "checks": [] } }
`
    )
    .action(async (opts: { destination: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          try {
            const plan = await createClient().controlPlaneRecoveryPlan.query({
              destinationId: normalizeCliInput(opts.destination, "Destination ID")
            });
            const safePlan = safePayload(plan);
            return ctx.success(safePlan, {
              human: () => renderRecoveryDetails("Recovery plan", safePlan)
            });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  recovery
    .command("run")
    .description("Create and verify a control-plane recovery bundle")
    .requiredOption("--destination <id>", "Existing backup destination ID")
    .option("--dry-run", "Preview readiness without creating a bundle")
    .option("-y, --yes", "Confirm bundle creation")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope: backup:run (dry-run uses backup:read)
Examples:
  daoflow backup recovery run --destination dest_123 --dry-run --json
  daoflow backup recovery run --destination dest_123 --yes
Example JSON shape: { "ok": true, "data": { "id": "rb_123", "status": "verified", "keyFingerprint": "sha256:..." } }
`
    )
    .action(
      async (
        opts: { destination: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            const destinationId = normalizeCliInput(opts.destination, "Destination ID");
            if (opts.dryRun && opts.yes) {
              return ctx.fail("Choose either --dry-run or --yes, not both.", {
                code: "INVALID_INPUT"
              });
            }

            if (opts.dryRun) {
              try {
                const plan = await createClient().controlPlaneRecoveryPlan.query({ destinationId });
                const data = { dryRun: true, plan: safePayload(plan) };
                return ctx.dryRun(data, {
                  json: { ok: true, data },
                  human: () => renderRecoveryDetails("Recovery plan (dry-run)", data.plan)
                });
              } catch (error) {
                ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
              }
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create a control-plane recovery bundle in destination ${destinationId}. Pass --yes to confirm.`
            );

            try {
              const bundle = safePayload(
                await createClient().triggerControlPlaneRecoveryBundle.mutate({ destinationId })
              );
              return ctx.success(bundle, {
                quiet: () => getRecoveryBundleId(bundle),
                human: () => renderRecoveryDetails("Control-plane recovery bundle", bundle)
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  recovery
    .command("list")
    .description("List recent control-plane recovery bundles")
    .option("--limit <n>", "Maximum bundles to show", "20")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope: backup:read
Example: daoflow backup recovery list --json
Example JSON shape: { "ok": true, "data": { "bundles": [{ "id": "rb_123", "status": "verified" }] } }
`
    )
    .action(async (opts: { limit: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          let limit: number;
          try {
            limit = parseLimit(opts.limit);
          } catch (error) {
            return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
          }
          try {
            const bundles = safePayload(
              await createClient().controlPlaneRecoveryBundles.query({ limit })
            );
            return ctx.success(bundles, { human: () => renderRecoveryList(bundles) });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  for (const item of [
    {
      name: "inspect",
      description: "Inspect a recovery bundle and its verification evidence",
      procedure: "controlPlaneRecoveryBundle",
      renderTitle: "Recovery bundle",
      example: "daoflow backup recovery inspect --bundle rb_123 --json"
    },
    {
      name: "download-metadata",
      description: "Show safe recovery-bundle metadata and manifest details",
      procedure: "controlPlaneRecoveryBundleMetadata",
      renderTitle: "Recovery bundle metadata",
      example: "daoflow backup recovery download-metadata --bundle rb_123 --json"
    }
  ] as const) {
    recovery
      .command(item.name)
      .description(item.description)
      .requiredOption("--bundle <id>", "Recovery bundle ID")
      .option("--json", "Output as JSON")
      .addHelpText(
        "after",
        `
Required scope: backup:read
Example: ${item.example}
Example JSON shape: { "ok": true, "data": { "bundleId": "rb_123", "keyFingerprint": "sha256:...", "manifest": { "formatVersion": 1 } } }
`
      )
      .action(async (opts: { bundle: string; json?: boolean }, command: Command) => {
        await runCommandAction({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            const bundleId = normalizeCliInput(opts.bundle, "Recovery bundle ID");
            try {
              const client = createClient();
              const result = safePayload(
                item.procedure === "controlPlaneRecoveryBundle"
                  ? await client.controlPlaneRecoveryBundle.query({ bundleId })
                  : await client.controlPlaneRecoveryBundleMetadata.query({ bundleId })
              );
              return ctx.success(result, {
                human: () => renderRecoveryDetails(item.renderTitle, result)
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      });
  }
}
