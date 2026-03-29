import { Command } from "commander";
import chalk from "chalk";
import { normalizeAuditSinceWindow } from "@daoflow/shared";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient, type RouterOutputs } from "../trpc-client";

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Limit must be an integer between 1 and 50.");
  }

  return limit;
}

function parseSince(rawSince: string): string {
  return normalizeAuditSinceWindow(rawSince);
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

function renderAuditTrail(entries: RouterOutputs["auditTrail"]["entries"]): void {
  if (entries.length === 0) {
    console.log(chalk.dim("  No audit entries recorded.\n"));
    return;
  }

  for (const entry of entries) {
    const tone = colorizeTone(entry.statusTone, entry.outcome);
    console.log(`  ${entry.createdAt}  ${tone}  ${entry.action}`);
    console.log(`    Actor: ${entry.actorLabel} (${entry.actorType})`);
    console.log(`    Resource: ${entry.resourceLabel}`);
    if (entry.permissionScope) {
      console.log(chalk.dim(`    Scope: ${entry.permissionScope}`));
    }
    if (entry.detail) {
      console.log(chalk.dim(`    Detail: ${entry.detail}`));
    }
    console.log();
  }
}

export function auditCommand(): Command {
  return new Command("audit")
    .description("Read the immutable audit trail")
    .option("--limit <n>", "Maximum audit entries to show", "12")
    .option("--since <window>", "Only include entries newer than a window like 15m, 1h, or 7d")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  any valid token

Examples:
  daoflow audit --limit 20
  daoflow audit --since 1h --json
  daoflow audit --limit 20 --since 7d --json

Example JSON shape:
  { "ok": true, "data": { "limit": 20, "since": "1h", "summary": { "totalEntries": 42, "deploymentActions": 12, "executionActions": 18, "backupActions": 4, "humanEntries": 9 }, "entries": [{ "id": "audit_123", "action": "deployment.created", "actorType": "user", "actorLabel": "owner@daoflow.local", "resourceType": "deployment", "resourceLabel": "deployment/dep_123", "permissionScope": "deploy:start", "outcome": "success", "statusTone": "healthy", "detail": "Queued deployment for web.", "createdAt": "2026-03-29T12:00:00.000Z" }] } }
`
    )
    .action(async (opts: { json?: boolean; limit: string; since?: string }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const currentContext = getCurrentContext();
          if (!currentContext) {
            return ctx.fail("Not logged in. Run `daoflow login` first.", {
              code: "NOT_LOGGED_IN"
            });
          }

          const limit = (() => {
            try {
              return parseLimit(opts.limit);
            } catch (error) {
              return ctx.fail(error instanceof Error ? error.message : String(error), {
                code: "INVALID_INPUT"
              });
            }
          })();
          const since = (() => {
            if (!opts.since) {
              return undefined;
            }

            try {
              return parseSince(opts.since);
            } catch (error) {
              return ctx.fail(error instanceof Error ? error.message : String(error), {
                code: "INVALID_INPUT"
              });
            }
          })();

          const trpc = createClient(currentContext);
          const auditTrail = await trpc.auditTrail.query({ limit, since });

          return ctx.success(
            {
              limit,
              since: since ?? null,
              summary: auditTrail.summary,
              entries: auditTrail.entries
            },
            {
              human: () => {
                console.log(chalk.bold("\n  Audit Trail\n"));
                console.log(
                  `  Total: ${auditTrail.summary.totalEntries}  Deploy: ${auditTrail.summary.deploymentActions}  Exec: ${auditTrail.summary.executionActions}  Backup: ${auditTrail.summary.backupActions}  Human: ${auditTrail.summary.humanEntries}`
                );
                if (since) {
                  console.log(chalk.dim(`  Window: last ${since}`));
                }
                console.log();
                renderAuditTrail(auditTrail.entries);
              }
            }
          );
        }
      });
    });
}
