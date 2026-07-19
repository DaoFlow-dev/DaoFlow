import chalk from "chalk";
import { Command } from "commander";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import type {
  ExternalArtifactRestorePlanOutput,
  ApprovalQueueRequestOutput
} from "../trpc-contract";
import { renderBackupError } from "./backup-shared";
import { DEFAULT_EXTERNAL_RESTORE_REASON, validateSafetyFlags } from "./backup-external-shared";

function renderPlan(plan: ExternalArtifactRestorePlanOutput): void {
  console.log(chalk.bold("\n  External Artifact Restore Plan (dry-run)\n"));
  if (typeof plan.isReady === "boolean") console.log(`  Ready: ${plan.isReady ? "yes" : "no"}`);

  if (plan.preflightChecks?.length) {
    console.log(chalk.dim("  Preflight checks:"));
    for (const check of plan.preflightChecks) {
      const marker = check.status === "ok" ? chalk.green("✓") : chalk.yellow("!");
      console.log(`    ${marker} ${check.detail}`);
    }
  }

  if (plan.steps?.length) {
    console.log(chalk.dim("  Steps:"));
    plan.steps.forEach((step, index) => console.log(`    ${index + 1}. ${step}`));
  }

  console.log(
    chalk.dim(
      "  Production restore is approval-only; this preview never queues a restore directly.\n"
    )
  );
}

function renderApprovalRequest(request: ApprovalQueueRequestOutput): void {
  console.log(chalk.green(`✅ Approval requested: ${request.id}`));
  console.log(`  Status: ${request.status}`);
  console.log(
    chalk.yellow(
      "  A different authorized actor must approve this request before any production restore can run."
    )
  );
}

export function registerExternalArtifactRestoreCommands(external: Command): void {
  external
    .command("verify")
    .description("Queue an isolated test restore for an external artifact")
    .requiredOption("--artifact-id <id>", "External artifact ID")
    .option("--dry-run", "Preview locally without making an API call")
    .option("-y, --yes", "Queue the isolated verification")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  execution: backup:restore

Examples:
  daoflow backup external verify --artifact-id xart_123 --dry-run --json
  daoflow backup external verify --artifact-id xart_123 --yes

Example JSON shape:
  { "ok": true, "data": { "id": "restore_123", "artifactId": "xart_123", "status": "queued" } }
`
    )
    .action(
      async (
        opts: { artifactId: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            let artifactId: string;
            try {
              artifactId = normalizeCliInput(opts.artifactId, "Artifact ID");
              validateSafetyFlags(opts.dryRun, opts.yes);
            } catch (error) {
              return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }

            if (opts.dryRun) {
              return ctx.dryRun(
                { dryRun: true, artifactId, action: "external-artifact-test-restore" },
                {
                  json: {
                    ok: true,
                    data: { dryRun: true, artifactId, action: "external-artifact-test-restore" }
                  },
                  human: () => {
                    console.log(chalk.bold("\n  External Artifact Verification (dry-run)\n"));
                    console.log(`  Artifact: ${artifactId}`);
                    console.log(chalk.dim("  No API mutation was made.\n"));
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To queue isolated verification for ${artifactId}, add --yes`
            );

            const trpc = createClient();
            const result = await trpc.triggerExternalArtifactTestRestore.mutate({ artifactId });
            return ctx.success(result, {
              quiet: () => result.id,
              human: () =>
                console.log(chalk.green(`✅ External artifact verification queued: ${result.id}`))
            });
          }
        });
      }
    );

  external
    .command("restore")
    .description("Request approval to restore an external artifact to a target volume")
    .requiredOption("--artifact-id <id>", "External artifact ID")
    .requiredOption("--target-volume <id>", "Target PostgreSQL volume ID")
    .option("--dry-run", "Preview the server restore plan")
    .option("-y, --yes", "Request production restore approval")
    .option("--reason <text>", "Reason for the approval request")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scopes:
  dry-run: backup:read
  execution: approvals:create, backup:restore

Examples:
  daoflow backup external restore --artifact-id xart_123 --target-volume vol_123 --dry-run --json
  daoflow backup external restore --artifact-id xart_123 --target-volume vol_123 --yes --reason "Restore after an incident"

Example JSON shapes:
  { "ok": true, "data": { "dryRun": true, "plan": { "isReady": true, "steps": ["Validate artifact"] } } }
  { "ok": true, "data": { "approvalRequested": true, "request": { "id": "apr_123", "actionType": "external-artifact-restore", "status": "pending" }, "nextAction": "A different authorized actor must approve this request before any production restore can run." } }
`
    )
    .action(
      async (
        opts: {
          artifactId: string;
          targetVolume: string;
          dryRun?: boolean;
          yes?: boolean;
          reason?: string;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            let artifactId: string;
            let targetVolumeId: string;
            let reason: string;
            try {
              artifactId = normalizeCliInput(opts.artifactId, "Artifact ID");
              targetVolumeId = normalizeCliInput(opts.targetVolume, "Target volume ID");
              reason =
                normalizeOptionalCliInput(opts.reason, "Reason", { maxLength: 1000 }) ??
                DEFAULT_EXTERNAL_RESTORE_REASON;
              validateSafetyFlags(opts.dryRun, opts.yes);
            } catch (error) {
              return ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }

            if (opts.dryRun) {
              const trpc = createClient();
              const plan = await trpc.externalArtifactRestorePlan.query({
                artifactId,
                targetVolumeId
              });
              return ctx.dryRun(
                { dryRun: true, plan },
                {
                  json: { ok: true, data: { dryRun: true, plan } },
                  human: () => renderPlan(plan)
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To request production restore approval for ${artifactId}, add --yes`
            );

            const trpc = createClient();
            const request = await trpc.requestExternalArtifactRestoreApproval.mutate({
              artifactId,
              targetVolumeId,
              reason
            });
            const nextAction =
              "A different authorized actor must approve this request before any production restore can run.";
            return ctx.success(
              { approvalRequested: true, request, nextAction },
              {
                quiet: () => request.id,
                human: () => renderApprovalRequest(request)
              }
            );
          }
        });
      }
    );
}
