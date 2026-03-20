import { Command } from "commander";
import { readFileSync } from "node:fs";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage } from "../command-helpers";
import { createClient, type RegisterServerOutput } from "../trpc-client";

const SERVER_ADD_HELP_TEXT = [
  "",
  "Required scope:",
  "  server:write",
  "",
  "Examples:",
  "  daoflow server add --name edge-vps-1 --host 203.0.113.42 --ssh-key ~/.ssh/daoflow_ed25519 --yes",
  "  daoflow server add --name local-dev --host localhost --region local --yes --json",
  "",
  "Example JSON shapes:",
  '  dry-run: { "ok": true, "data": { "dryRun": true, "name": "edge-vps-1", "host": "203.0.113.42" } }',
  '  execute: { "ok": true, "data": { "server": { "id": "srv_123", "status": "ready" }, "readiness": { "sshReachable": true, "dockerReachable": true, "composeReachable": true } } }'
].join("\n");

interface ServerReadinessSummary {
  readinessStatus: string;
  sshReachable: boolean;
  dockerReachable: boolean;
  composeReachable: boolean;
  latencyMs: number | null;
  checkedAt: string | null;
  issues: string[];
  recommendedActions: string[];
}

interface ServerAddDryRunResult {
  dryRun: true;
  name: string;
  host: string;
  region: string;
  sshPort: number;
  sshUser?: string;
  sshPrivateKey?: string;
  sshPrivateKeyProvided: boolean;
  kind: "docker-engine" | "docker-swarm-manager";
}

interface ServerAddSuccessResult {
  server: {
    id: string;
    name: string;
    host: string;
    region: string | null;
    sshPort: number;
    sshUser: string | null;
    kind: string;
    status: string;
    dockerVersion: string | null;
    composeVersion: string | null;
  };
  readiness: ServerReadinessSummary;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid SSH port: ${value}`);
  }
  return parsed;
}

function readPrivateKey(
  keyPath: string | undefined,
  inlineKey: string | undefined
): string | undefined {
  if (keyPath && inlineKey) {
    throw new Error("Use either --ssh-key or --ssh-private-key, not both.");
  }

  if (keyPath) {
    return readFileSync(keyPath, "utf8").trim();
  }

  return inlineKey?.trim() || undefined;
}

function summarizeReadiness(server: RegisterServerOutput): ServerReadinessSummary {
  const readiness = server.readiness ?? server.metadata?.readinessCheck;
  return {
    readinessStatus: readiness?.readinessStatus ?? server.status,
    sshReachable: readiness?.sshReachable ?? false,
    dockerReachable: readiness?.dockerReachable ?? false,
    composeReachable: readiness?.composeReachable ?? false,
    latencyMs: readiness?.latencyMs ?? null,
    checkedAt: readiness?.checkedAt ?? null,
    issues: readiness?.issues ?? [],
    recommendedActions: readiness?.recommendedActions ?? []
  };
}

export function serverCommand(): Command {
  const cmd = new Command("server").description("Register and inspect deployment targets");

  cmd
    .command("add")
    .description("Register a Docker host and run readiness verification")
    .requiredOption("--name <name>", "Server name")
    .requiredOption("--host <host>", "Server hostname or IP address")
    .option("--region <region>", "Region label", "default")
    .option("--ssh-port <port>", "SSH port", parsePort, 22)
    .option("--ssh-user <user>", "SSH username", "root")
    .option("--ssh-key <path>", "Path to the SSH private key file")
    .option("--ssh-private-key <pem>", "Inline SSH private key material")
    .option("--kind <kind>", "Target kind (docker-engine or docker-swarm-manager)", "docker-engine")
    .option("--dry-run", "Preview the registration payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText("after", SERVER_ADD_HELP_TEXT)
    .action(
      async (
        opts: {
          name: string;
          host: string;
          region: string;
          sshPort: number;
          sshUser?: string;
          sshKey?: string;
          sshPrivateKey?: string;
          kind: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<ServerAddDryRunResult | ServerAddSuccessResult>({
          command,
          json: opts.json,
          action: async (ctx) => {
            if (!["docker-engine", "docker-swarm-manager"].includes(opts.kind)) {
              ctx.fail(`Unsupported server kind: ${opts.kind}`, { code: "INVALID_INPUT" });
            }

            let sshPrivateKey: string | undefined;
            try {
              sshPrivateKey = readPrivateKey(opts.sshKey, opts.sshPrivateKey);
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "INVALID_INPUT" });
            }

            const payload = {
              name: opts.name.trim(),
              host: opts.host.trim(),
              region: opts.region.trim() || "default",
              sshPort: opts.sshPort,
              sshUser: opts.sshUser?.trim() || undefined,
              sshPrivateKey,
              kind: opts.kind as "docker-engine" | "docker-swarm-manager"
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload,
                  sshPrivateKeyProvided: Boolean(payload.sshPrivateKey)
                },
                {
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: register server ${payload.name}\n`));
                    console.log(`  Host:      ${payload.host}`);
                    console.log(`  Region:    ${payload.region}`);
                    console.log(
                      `  SSH:       ${payload.sshUser ?? "default"}@${payload.host}:${payload.sshPort}`
                    );
                    console.log(`  Kind:      ${payload.kind}`);
                    console.log(
                      `  SSH key:   ${payload.sshPrivateKey ? "provided" : "not provided"}`
                    );
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Register server ${payload.name} at ${payload.host}. Pass --yes to confirm.`,
              {
                humanMessage: `Register server ${payload.name} at ${payload.host}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const server = await trpc.registerServer.mutate(payload);
            const readiness = summarizeReadiness(server);
            const serverSummary = {
              id: server.id,
              name: server.name,
              host: server.host,
              region: server.region,
              sshPort: server.sshPort,
              sshUser: server.sshUser,
              kind: server.kind,
              status: server.status,
              dockerVersion: server.dockerVersion,
              composeVersion: server.composeVersion
            };

            return ctx.success(
              {
                server: serverSummary,
                readiness
              },
              {
                human: () => {
                  console.log(chalk.green(`✓ Registered ${server.name} (${server.id})`));
                  console.log(
                    chalk.dim(
                      `  ${server.host} · SSH ${server.sshPort} · ${server.kind} · readiness ${readiness.readinessStatus}`
                    )
                  );
                  if (server.dockerVersion || server.composeVersion) {
                    console.log(
                      chalk.dim(
                        `  Docker ${server.dockerVersion ?? "unavailable"} · Compose ${server.composeVersion ?? "unavailable"}`
                      )
                    );
                  }
                  console.log(
                    `  SSH ${readiness.sshReachable ? "ok" : "blocked"} · Docker ${readiness.dockerReachable ? "ok" : "blocked"} · Compose ${readiness.composeReachable ? "ok" : "blocked"}`
                  );
                  if (readiness.issues.length > 0) {
                    console.log(chalk.yellow("\n  Issues:"));
                    for (const issue of readiness.issues) {
                      console.log(`    - ${issue}`);
                    }
                  }
                  if (readiness.recommendedActions.length > 0) {
                    console.log(chalk.cyan("\n  Recommended actions:"));
                    for (const action of readiness.recommendedActions) {
                      console.log(`    - ${action}`);
                    }
                  }
                  console.log();
                }
              }
            );
          }
        });
      }
    );

  return cmd;
}
