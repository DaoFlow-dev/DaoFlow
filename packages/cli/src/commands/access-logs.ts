import { Command } from "commander";
import chalk from "chalk";
import { normalizeAuditSinceWindow } from "@daoflow/shared";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient, type RouterOutputs } from "../trpc-client";

type AccessLogStatus = "failed-auth" | "denied" | "error" | "slow" | "webhook" | "api-token";
type ActorType = "user" | "service" | "agent" | "token";

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }
  return limit;
}

function parseMinDuration(rawValue?: string): number | undefined {
  if (!rawValue) return undefined;
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new Error("Minimum duration must be an integer between 1 and 60000.");
  }
  return value;
}

function parseStatus(rawStatus?: string): AccessLogStatus | undefined {
  if (!rawStatus) return undefined;
  const allowed = ["failed-auth", "denied", "error", "slow", "webhook", "api-token"] as const;
  if (!allowed.includes(rawStatus as AccessLogStatus)) {
    throw new Error(`Status must be one of: ${allowed.join(", ")}.`);
  }
  return rawStatus as AccessLogStatus;
}

function parseActorType(rawActorType?: string): ActorType | undefined {
  if (!rawActorType) return undefined;
  const allowed = ["user", "service", "agent", "token"] as const;
  if (!allowed.includes(rawActorType as ActorType)) {
    throw new Error(`Actor type must be one of: ${allowed.join(", ")}.`);
  }
  return rawActorType as ActorType;
}

function renderAccessLogs(entries: RouterOutputs["accessLogs"]["entries"]): void {
  if (entries.length === 0) {
    console.log(chalk.dim("  No access log entries matched.\n"));
    return;
  }

  for (const entry of entries) {
    const failed = entry.statusCode >= 400;
    const status = failed
      ? chalk.red(String(entry.statusCode))
      : chalk.green(String(entry.statusCode));
    const actor = entry.actorEmail ?? entry.tokenName ?? entry.actorId ?? "anonymous";
    console.log(`  ${entry.createdAt}  ${status}  ${entry.method} ${entry.path}`);
    console.log(`    ${entry.durationMs}ms · ${entry.category} · ${entry.outcome}`);
    console.log(chalk.dim(`    Actor: ${actor} · Source: ${entry.sourceIp ?? "unknown"}`));
    console.log(chalk.dim(`    Request: ${entry.requestId}`));
    if (entry.errorCategory) {
      console.log(chalk.dim(`    Error: ${entry.errorCategory}`));
    }
    console.log();
  }
}

export function accessLogsCommand(): Command {
  return new Command("access-logs")
    .description("Read durable request and access logs")
    .option("--limit <n>", "Maximum entries to show", "50")
    .option("--cursor <cursor>", "Pagination cursor from a previous response")
    .option("--since <window>", "Only include entries newer than a window like 15m, 1h, or 7d")
    .option(
      "--status <status>",
      "Filter by failed-auth, denied, error, slow, webhook, or api-token"
    )
    .option("--method <method>", "Filter by HTTP method")
    .option("--path <pattern>", "Filter by path pattern, supports * wildcard")
    .option("--actor-type <type>", "Filter by user, service, agent, or token")
    .option("--token <id>", "Filter by API token id")
    .option("--request-id <id>", "Filter by request id")
    .option("--search <term>", "Search request id, path, actor email, or token name")
    .option("--min-duration-ms <ms>", "Only include requests at least this slow")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  logs:read

Examples:
  daoflow access-logs --limit 50
  daoflow access-logs --status failed-auth --json
  daoflow access-logs --request-id req-abc123 --json
  daoflow access-logs --path "/api/webhooks/*" --min-duration-ms 1000 --json

Example JSON shape:
  { "ok": true, "data": { "limit": 50, "cursor": null, "nextCursor": "2026-05-06T18:00:00.000Z", "summary": { "totalEntries": 128, "failedAuth": 9, "deniedScopes": 4, "webhookRequests": 22, "apiTokenRequests": 37, "slowRequests": 3, "errorResponses": 11 }, "entries": [{ "id": "rlog_123", "requestId": "req-abc123", "method": "POST", "path": "/api/webhooks/github", "statusCode": 403, "outcome": "denied", "tokenPrefix": "dfl_ci_abcd", "errorCategory": "SCOPE_DENIED", "createdAt": "2026-05-06T18:00:00.000Z" }] } }
`
    )
    .action(
      async (
        opts: {
          json?: boolean;
          limit: string;
          cursor?: string;
          since?: string;
          status?: string;
          method?: string;
          path?: string;
          actorType?: string;
          token?: string;
          requestId?: string;
          search?: string;
          minDurationMs?: string;
        },
        command: Command
      ) => {
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

            let limit: number;
            let since: string | undefined;
            let status: AccessLogStatus | undefined;
            let actorType: ActorType | undefined;
            let minDurationMs: number | undefined;
            try {
              limit = parseLimit(opts.limit);
              since = opts.since ? normalizeAuditSinceWindow(opts.since) : undefined;
              status = parseStatus(opts.status);
              actorType = parseActorType(opts.actorType);
              minDurationMs = parseMinDuration(opts.minDurationMs);
            } catch (error) {
              return ctx.fail(error instanceof Error ? error.message : String(error), {
                code: "INVALID_INPUT"
              });
            }

            const trpc = createClient(currentContext);
            const result = await trpc.accessLogs.query({
              limit,
              cursor: opts.cursor,
              since,
              status,
              method: opts.method,
              path: opts.path,
              actorType,
              tokenId: opts.token,
              requestId: opts.requestId,
              search: opts.search,
              minDurationMs
            });

            return ctx.success(result, {
              human: () => {
                console.log(chalk.bold("\n  Access Logs\n"));
                console.log(
                  `  Total: ${result.summary.totalEntries}  Failed auth: ${result.summary.failedAuth}  Denied: ${result.summary.deniedScopes}  Token: ${result.summary.apiTokenRequests}  Slow: ${result.summary.slowRequests}`
                );
                console.log(chalk.dim(`  Retention: ${result.retentionDays} days`));
                console.log();
                renderAccessLogs(result.entries);
              }
            });
          }
        });
      }
    );
}
