import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import type { ApprovalQueueOutput, ApprovalQueueRequestOutput } from "../trpc-contract";
import { createClient } from "../trpc-client";

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) {
    throw new Error("Limit must be an integer between 1 and 40.");
  }

  return limit;
}

function colorizeTone(tone: string, value: string): string {
  if (tone === "healthy") {
    return chalk.green(value);
  }

  if (tone === "failed") {
    return chalk.red(value);
  }

  if (tone === "running") {
    return chalk.yellow(value);
  }

  return chalk.dim(value);
}

function renderApprovalQueue(queue: ApprovalQueueOutput): void {
  console.log(chalk.bold("\n  Approval Queue\n"));
  console.log(
    `  Total: ${queue.summary.totalRequests}  Pending: ${queue.summary.pendingRequests}  Approved: ${queue.summary.approvedRequests}  Rejected: ${queue.summary.rejectedRequests}  Critical pending: ${queue.summary.criticalRequests}`
  );
  console.log();

  if (queue.requests.length === 0) {
    console.log(chalk.dim("  No approval requests queued.\n"));
    return;
  }

  for (const request of queue.requests) {
    console.log(
      `  ${request.createdAt}  ${colorizeTone(request.statusTone, request.status.toUpperCase())}  ${request.actionType}`
    );
    console.log(`    Request: ${request.id}`);
    console.log(`    Resource: ${request.resourceLabel}`);
    console.log(
      `    Requested by: ${request.requestedBy || request.requestedByEmail || "unknown"}`
    );
    console.log(`    Reason: ${request.reason}`);
    console.log(chalk.dim(`    Summary: ${request.commandSummary}`));

    if (request.decidedBy && request.decidedAt) {
      console.log(chalk.dim(`    Decided by: ${request.decidedBy} at ${request.decidedAt}`));
    }

    if (request.recommendedChecks.length > 0) {
      console.log(chalk.dim(`    Checks: ${request.recommendedChecks.join(" | ")}`));
    }

    console.log();
  }
}

function renderApprovalDecision(
  decision: "approved" | "rejected",
  request: ApprovalQueueRequestOutput
): void {
  const icon = decision === "approved" ? chalk.green("✓") : chalk.yellow("•");
  const verb = decision === "approved" ? "Approved" : "Rejected";

  console.log(`${icon} ${verb} approval request ${request.id}`);
  console.log(chalk.dim(`  Resource: ${request.resourceLabel}`));
  console.log(chalk.dim(`  Action: ${request.actionType}`));
  if (request.decidedBy) {
    console.log(chalk.dim(`  Decided by: ${request.decidedBy}`));
  }
}

function registerDecisionCommand(parent: Command, name: "approve" | "reject"): void {
  const decision = name === "approve" ? "approved" : "rejected";
  const scopeSentence =
    name === "approve" ? "Approve a queued approval request" : "Reject a queued approval request";

  parent
    .command(name)
    .description(scopeSentence)
    .requiredOption("--request <id>", "Approval request ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  approvals:decide

Examples:
  daoflow approvals ${name} --request apr_123 --yes
  daoflow approvals ${name} --request apr_123 --yes --json

Example JSON shape:
  { "ok": true, "data": { "request": { "id": "apr_123", "actionType": "backup-restore", "targetResource": "backup-run/bkr_123", "resourceLabel": "postgres-volume@production-us-west", "status": "${decision}", "statusTone": "${name === "approve" ? "healthy" : "failed"}", "reason": "Restore after failed migration.", "decidedBy": "ops@daoflow.local", "decidedAt": "2026-03-29T12:30:00.000Z" } } }
`
    )
    .action(async (opts: { request: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const requestId = normalizeCliInput(opts.request, "Approval request ID");

          ctx.requireConfirmation(
            opts.yes === true,
            `${scopeSentence} ${requestId}. Pass --yes to confirm.`
          );

          const trpc = createClient();
          const request =
            name === "approve"
              ? await trpc.approveApprovalRequest.mutate({ requestId })
              : await trpc.rejectApprovalRequest.mutate({ requestId });

          return ctx.success(
            { request },
            {
              quiet: () => request.id,
              human: () => {
                renderApprovalDecision(decision, request);
              }
            }
          );
        }
      });
    });
}

export function approvalsCommand(): Command {
  const approvals = new Command("approvals").description("Review and decide queued approvals");

  approvals
    .command("list")
    .description("List queued approval requests")
    .option("--limit <n>", "Maximum approval requests to show", "24")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  any valid token

Examples:
  daoflow approvals list
  daoflow approvals list --limit 10 --json

Example JSON shape:
  { "ok": true, "data": { "limit": 10, "summary": { "totalRequests": 4, "pendingRequests": 2, "approvedRequests": 1, "rejectedRequests": 1, "criticalRequests": 1 }, "requests": [{ "id": "apr_123", "actionType": "backup-restore", "targetResource": "backup-run/bkr_123", "resourceLabel": "postgres-volume@production-us-west", "riskLevel": "critical", "status": "pending", "statusTone": "failed", "requestedBy": "agent@daoflow.local", "commandSummary": "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.", "requestedAt": "2026-03-29T12:00:00.000Z", "expiresAt": "2026-03-29T19:00:00.000Z", "recommendedChecks": ["Confirm the target volume is isolated from live writes before replaying snapshot data."] }] } }
`
    )
    .action(async (opts: { limit: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const limit = (() => {
            try {
              return parseLimit(opts.limit);
            } catch (error) {
              return ctx.fail(error instanceof Error ? error.message : String(error), {
                code: "INVALID_INPUT"
              });
            }
          })();

          const trpc = createClient();
          const queue = await trpc.approvalQueue.query({ limit });

          return ctx.success(
            {
              limit,
              summary: queue.summary,
              requests: queue.requests
            },
            {
              human: () => {
                renderApprovalQueue(queue);
              }
            }
          );
        }
      });
    });

  registerDecisionCommand(approvals, "approve");
  registerDecisionCommand(approvals, "reject");

  return approvals;
}
