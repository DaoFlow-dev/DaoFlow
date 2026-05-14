import { Command, Option } from "commander";
import chalk from "chalk";
import {
  getErrorMessage,
  normalizeCliInput,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { ApiClient } from "../api-client";
import { createAuthenticatedWebSocket } from "../live-websocket";
import { createClient } from "../trpc-client";

type FollowLogLine = {
  id?: string | number;
  level?: string;
  message: string;
  source?: string | null;
  stream?: "stdout" | "stderr";
  timestamp?: string;
  createdAt?: string;
  done?: boolean;
};

function parseLineLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "50", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2000) {
    throw new Error("--lines must be between 1 and 2000.");
  }
  return parsed;
}

function normalizeStream(line: FollowLogLine): "stdout" | "stderr" {
  return line.stream === "stderr" || line.level === "error" ? "stderr" : "stdout";
}

function shouldPrintFollowLine(
  line: FollowLogLine,
  input: { query?: string; stream?: "all" | "stdout" | "stderr" }
) {
  const stream = normalizeStream(line);
  if (input.stream && input.stream !== "all" && input.stream !== stream) {
    return false;
  }
  if (input.query && !line.message.toLowerCase().includes(input.query.toLowerCase())) {
    return false;
  }
  return true;
}

function printFollowLine(
  line: FollowLogLine,
  input: { json: boolean; stream?: "all" | "stdout" | "stderr"; query?: string }
) {
  if (line.done) return;
  if (!shouldPrintFollowLine(line, input)) return;

  const stream = normalizeStream(line);
  const timestamp = line.timestamp ?? line.createdAt ?? new Date().toISOString();
  const data = {
    id: line.id ?? null,
    timestamp,
    stream,
    level: line.level ?? (stream === "stderr" ? "error" : "info"),
    source: line.source ?? null,
    message: line.message
  };

  if (input.json) {
    console.log(JSON.stringify({ ok: true, data }));
    return;
  }

  const ts = chalk.dim(timestamp.slice(11, 23));
  const level = stream === "stderr" ? chalk.red("ERR") : chalk.blue("OUT");
  console.log(`${ts} ${level} ${line.message}`);
}

async function followDeploymentLogs(input: {
  deploymentId: string;
  json: boolean;
  query?: string;
  stream?: "all" | "stdout" | "stderr";
}) {
  const api = new ApiClient();
  await api.sse(`/api/v1/logs/stream/${encodeURIComponent(input.deploymentId)}`, (event) => {
    const line = JSON.parse(event) as FollowLogLine;
    printFollowLine(line, input);
  });
}

async function followServiceLogs(input: {
  serviceId: string;
  json: boolean;
  query?: string;
  stream?: "all" | "stdout" | "stderr";
  tail: number;
}) {
  await new Promise<void>((resolve, reject) => {
    const ws = createAuthenticatedWebSocket("/ws/container-logs", {
      serviceId: input.serviceId,
      tail: input.tail
    });

    ws.onmessage = (event) => {
      const line = JSON.parse(String(event.data)) as FollowLogLine;
      printFollowLine(line, input);
    };
    ws.onerror = () => reject(new Error("Live service log stream failed."));
    ws.onclose = () => resolve();
  });
}

export function logsCommand(): Command {
  return new Command("logs")
    .description("Fetch persisted deployment logs from the control plane")
    .argument("[service]", "Service name to filter when querying recent logs")
    .option("--deployment <id>", "Deployment ID")
    .option("--service-id <id>", "Service ID for live --follow container logs")
    .option("--query <text>", "Search within persisted log messages")
    .option("--grep <text>", "Alias for --query: filter log lines by keyword")
    .option("--follow", "Follow log output", false)
    .option("--lines <n>", "Number of lines to show", "50")
    .addOption(
      new Option("--stream <stream>", "Filter by stream")
        .choices(["all", "stdout", "stderr"])
        .default("all")
    )
    .option("--json", "Output as JSON")
    .action(
      async (
        service: string | undefined,
        opts: {
          deployment?: string;
          serviceId?: string;
          query?: string;
          grep?: string;
          follow?: boolean;
          lines?: string;
          stream?: "all" | "stdout" | "stderr";
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);
        const query = opts.query ?? opts.grep;
        await withResolvedCommandRequestOptions(command, async () => {
          if (opts.follow) {
            try {
              const lines = parseLineLimit(opts.lines);
              if (opts.deployment) {
                await followDeploymentLogs({
                  deploymentId: normalizeCliInput(opts.deployment, "Deployment ID"),
                  json: isJson,
                  query,
                  stream: opts.stream
                });
                return;
              }

              if (opts.serviceId) {
                await followServiceLogs({
                  serviceId: normalizeCliInput(opts.serviceId, "Service ID"),
                  json: isJson,
                  query,
                  stream: opts.stream,
                  tail: lines
                });
                return;
              }

              const error = "Use --deployment or --service-id with --follow.";
              if (isJson) {
                console.log(JSON.stringify({ ok: false, error, code: "INVALID_INPUT" }));
              } else {
                console.error(chalk.yellow(error));
              }
              process.exit(1);
              return;
            } catch (error) {
              if (isJson) {
                console.log(
                  JSON.stringify({
                    ok: false,
                    error: getErrorMessage(error),
                    code: "API_ERROR"
                  })
                );
              } else {
                console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
              }
              process.exit(1);
              return;
            }
          }

          try {
            const trpc = createClient();
            const lines = parseLineLimit(opts.lines);
            const data = await trpc.deploymentLogs.query({
              deploymentId: opts.deployment,
              service,
              query,
              stream: opts.stream,
              limit: lines
            });

            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: true,
                  data: {
                    service: service ?? null,
                    deploymentId: opts.deployment ?? null,
                    query: query ?? null,
                    stream: opts.stream ?? "all",
                    limit: lines,
                    summary: data.summary,
                    lines: data.lines
                  }
                })
              );
              return;
            }

            for (const line of data.lines) {
              const ts = chalk.dim(line.createdAt.slice(11, 23));
              const level = line.stream === "stderr" ? chalk.red("ERR") : chalk.blue("OUT");
              console.log(`${ts} ${level} ${line.message}`);
            }
          } catch (error) {
            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: false,
                  error: getErrorMessage(error),
                  code: "API_ERROR"
                })
              );
            } else {
              console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
            }
            process.exit(1);
          }
        });
      }
    );
}
