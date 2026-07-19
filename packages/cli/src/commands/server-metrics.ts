import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { ApiClient } from "../api-client";

interface ServerMetricsSnapshot {
  id?: string;
  serverId?: string;
  cpuPercent: number;
  memoryUsedPercent: number;
  memoryUsedGB: number;
  memoryTotalGB: number;
  diskUsedPercent: number;
  diskTotalGB: number;
  dockerDiskUsedPercent?: number | null;
  dockerDiskTotalGB?: number | null;
  networkInMB: number;
  networkOutMB: number;
  collectedAt?: string;
}

interface ServerMetricPolicy {
  sampleIntervalSeconds: number;
  retentionDays: number;
  cpuWarnPercent: number;
  cpuHardPercent: number;
  memoryWarnPercent: number;
  memoryHardPercent: number;
  diskWarnPercent: number;
  diskHardPercent: number;
  dockerDiskWarnPercent: number;
  dockerDiskHardPercent: number;
  cooldownMinutes: number;
}

interface ServerMetricState {
  status: "healthy" | "warning" | "hard" | "unreachable";
  metric: string | null;
  measuredValue: number | null;
  threshold: number | null;
  activeMetrics?: Array<{
    metric: string;
    status: "warning" | "hard";
    measuredValue: number | null;
    threshold: number | null;
  }>;
  changedAt: string | null;
  lastAlertedAt: string | null;
  error: string | null;
}

interface ServerMetricMonitoring {
  serverId: string;
  policy: ServerMetricPolicy;
  state: ServerMetricState;
  latest: ServerMetricsSnapshot | null;
  history: ServerMetricsSnapshot[];
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  return color("[" + "#".repeat(filled) + "-".repeat(empty) + "]") + ` ${pct.toFixed(1)}%`;
}

function parseLimit(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500 ? parsed : null;
}

function parseSince(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const match = /^(\d+)([mhdw])$/.exec(normalized);
  if (!match || Number(match[1]) < 1) return null;
  return normalized;
}

function statusLabel(state: ServerMetricState): string {
  const label = state.status.toUpperCase();
  if (state.status === "healthy") return chalk.green(label);
  if (state.status === "warning") return chalk.yellow(label);
  return chalk.red(label);
}

function thresholdLabel(value: number): string {
  return value === 0 ? "off" : `${value}%`;
}

function printSnapshot(snapshot: ServerMetricsSnapshot) {
  console.log(`  CPU:         ${bar(snapshot.cpuPercent)}`);
  console.log(
    `  Memory:      ${bar(snapshot.memoryUsedPercent)}  ${snapshot.memoryUsedGB.toFixed(1)} / ${snapshot.memoryTotalGB.toFixed(1)} GB`
  );
  console.log(
    `  Root disk:   ${bar(snapshot.diskUsedPercent)}  ${snapshot.diskTotalGB.toFixed(0)} GB total`
  );
  if (typeof snapshot.dockerDiskUsedPercent === "number") {
    const total =
      typeof snapshot.dockerDiskTotalGB === "number"
        ? `  ${snapshot.dockerDiskTotalGB.toFixed(1)} GB total`
        : "";
    console.log(`  Docker disk: ${bar(snapshot.dockerDiskUsedPercent)}${total}`);
  }
  console.log(
    `  Network:     ${chalk.cyan("↓")} ${snapshot.networkInMB.toFixed(1)} MB  ${chalk.cyan("↑")} ${snapshot.networkOutMB.toFixed(1)} MB`
  );
}

export function serverMetricsCommand(): Command {
  return new Command("server-metrics")
    .description("Show host-level server metrics (CPU, memory, disk, network)")
    .requiredOption("--server <id>", "Server ID")
    .option("--live", "Collect fresh metrics (slower, ~2s)")
    .option("--monitoring", "Show persisted history, threshold state, and monitoring policy")
    .option("--since <window>", "Recent history window, such as 30m, 24h, or 2w", "24h")
    .option("--limit <count>", "Maximum history samples (1-500)", "60")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  diagnostics:read

Examples:
  daoflow server-metrics --server srv_abc123
  daoflow server-metrics --server srv_abc123 --monitoring --since 7d --limit 100
  daoflow server-metrics --server srv_abc123 --live
  daoflow server-metrics --server srv_abc123 --json
`
    )
    .action(
      async (
        opts: {
          server: string;
          live?: boolean;
          monitoring?: boolean;
          since: string;
          limit: string;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<ServerMetricMonitoring | ServerMetricsSnapshot>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const currentContext = getCurrentContext();
            if (!currentContext) {
              return ctx.fail("Not logged in. Run `daoflow login` first.", {
                code: "NOT_LOGGED_IN"
              });
            }

            const api = new ApiClient();
            const limit = parseLimit(opts.limit);
            if (limit === null) {
              return ctx.fail("Limit must be a whole number from 1 to 500.", {
                code: "INVALID_INPUT"
              });
            }
            const since = parseSince(opts.since);
            if (since === null) {
              return ctx.fail(
                "History window must use a positive value followed by m, h, d, or w.",
                {
                  code: "INVALID_INPUT"
                }
              );
            }

            const basePath = `/api/v1/server-metrics/${encodeURIComponent(opts.server)}`;
            if (opts.live) {
              const data = await api.get<ServerMetricsSnapshot>(`${basePath}?live=true`);

              return ctx.success(data, {
                human: () => {
                  console.log(chalk.bold("\n  Live Server Metrics\n"));
                  printSnapshot(data);
                  console.log();
                }
              });
            }

            if (!opts.monitoring) {
              const data = await api.get<ServerMetricsSnapshot>(basePath);
              return ctx.success(data, {
                human: () => {
                  console.log(chalk.bold("\n  Server Metrics\n"));
                  printSnapshot(data);
                  console.log();
                }
              });
            }

            const params = new URLSearchParams({
              monitoring: "true",
              since,
              limit: String(limit)
            });
            const data = await api.get<ServerMetricMonitoring>(`${basePath}?${params.toString()}`);

            return ctx.success(data, {
              human: () => {
                console.log(chalk.bold("\n  Server Monitoring\n"));
                console.log(`  State: ${statusLabel(data.state)}`);
                if ((data.state.activeMetrics?.length ?? 0) > 0) {
                  for (const metric of data.state.activeMetrics ?? []) {
                    const measured =
                      metric.measuredValue === null ? "n/a" : `${metric.measuredValue.toFixed(1)}%`;
                    const threshold =
                      metric.threshold === null ? "n/a" : `${metric.threshold.toFixed(1)}%`;
                    console.log(
                      `  Trigger: ${metric.metric} ${measured} (${metric.status} threshold ${threshold})`
                    );
                  }
                } else if (data.state.metric && data.state.measuredValue !== null) {
                  const threshold =
                    data.state.threshold === null ? "n/a" : `${data.state.threshold.toFixed(1)}%`;
                  console.log(
                    `  Trigger: ${data.state.metric} ${data.state.measuredValue.toFixed(1)}% (threshold ${threshold})`
                  );
                }
                if (data.state.error) {
                  console.log(`  Error: ${chalk.red(data.state.error)}`);
                }

                if (data.latest) {
                  console.log(chalk.bold("\n  Latest sample\n"));
                  printSnapshot(data.latest);
                  if (data.latest.collectedAt) {
                    console.log(chalk.dim(`  Collected: ${data.latest.collectedAt}`));
                  }
                } else {
                  console.log(chalk.dim("\n  No metric samples have been collected yet."));
                }

                console.log(chalk.bold("\n  Policy\n"));
                console.log(
                  `  CPU warn/hard: ${thresholdLabel(data.policy.cpuWarnPercent)} / ${thresholdLabel(data.policy.cpuHardPercent)}`
                );
                console.log(
                  `  Memory warn/hard: ${thresholdLabel(data.policy.memoryWarnPercent)} / ${thresholdLabel(data.policy.memoryHardPercent)}`
                );
                console.log(
                  `  Root disk warn/hard: ${thresholdLabel(data.policy.diskWarnPercent)} / ${thresholdLabel(data.policy.diskHardPercent)}`
                );
                console.log(
                  `  Docker disk warn/hard: ${thresholdLabel(data.policy.dockerDiskWarnPercent)} / ${thresholdLabel(data.policy.dockerDiskHardPercent)}`
                );
                console.log(
                  chalk.dim(
                    `  Every ${data.policy.sampleIntervalSeconds}s · Retain ${data.policy.retentionDays}d · Cooldown ${data.policy.cooldownMinutes}m`
                  )
                );

                console.log(chalk.bold(`\n  Recent history (${data.history.length})\n`));
                for (const sample of data.history.slice(0, 10)) {
                  console.log(
                    `  ${sample.collectedAt ?? "unknown"}  CPU ${sample.cpuPercent.toFixed(1)}%  MEM ${sample.memoryUsedPercent.toFixed(1)}%  DISK ${sample.diskUsedPercent.toFixed(1)}%  DOCKER ${(sample.dockerDiskUsedPercent ?? 0).toFixed(1)}%`
                  );
                }
                if (data.history.length > 10) {
                  console.log(
                    chalk.dim(`  … ${data.history.length - 10} more sample(s) in JSON output`)
                  );
                }
                console.log();
              }
            });
          }
        });
      }
    );
}
