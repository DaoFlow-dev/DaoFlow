import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

function parseTargetPort(value?: string): number | null {
  const raw = normalizeOptionalCliInput(value, "Target port");
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Target port must be between 1 and 65535.");
  }
  return parsed;
}

export function serviceDomainCommand(): Command {
  const domain = new Command("domain").description("Manage service domain routing");

  domain
    .command("routing")
    .description("Switch a service domain between observation and managed Traefik")
    .requiredOption("--service <id>", "Service ID")
    .requiredOption("--domain <id>", "Domain ID")
    .requiredOption("--mode <mode>", "Routing mode (observed|managed-traefik)")
    .option("--target-port <port>", "Container port for managed Traefik")
    .option("--dry-run", "Preview the routing payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          service: string;
          domain: string;
          mode: string;
          targetPort?: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<Record<string, unknown>>({
          command,
          json: opts.json,
          action: async (ctx) => {
            if (opts.mode !== "observed" && opts.mode !== "managed-traefik") {
              return ctx.fail("Mode must be observed or managed-traefik.", {
                code: "INVALID_INPUT"
              });
            }

            const routingMode = opts.mode === "observed" ? "observed" : "managed-traefik";
            const targetPort = parseTargetPort(opts.targetPort);
            const payload: {
              serviceId: string;
              domainId: string;
              routingMode: "observed" | "managed-traefik";
              targetPort: number | null;
            } = {
              serviceId: normalizeCliInput(opts.service, "Service ID"),
              domainId: normalizeCliInput(opts.domain, "Domain ID"),
              routingMode,
              targetPort: routingMode === "managed-traefik" ? targetPort : null
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  human: () => {
                    console.log(chalk.bold("\n  Dry-run: update service domain routing\n"));
                    console.log(`  Service: ${payload.serviceId}`);
                    console.log(`  Domain:  ${payload.domainId}`);
                    console.log(`  Mode:    ${payload.routingMode}`);
                    console.log(`  Port:    ${payload.targetPort ?? "auto"}`);
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Update routing for domain ${payload.domainId}. Pass --yes to confirm.`,
              {
                humanMessage: `Update routing for domain ${payload.domainId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const state = await trpc.updateServiceDomainRouting.mutate(payload);
            return ctx.success(
              {
                serviceId: state.serviceId,
                domain: state.domains.find((domainRecord) => domainRecord.id === payload.domainId)
              },
              {
                quiet: () => payload.domainId,
                human: () => {
                  console.log(chalk.green(`✓ Updated routing for ${payload.domainId}`));
                  console.log();
                }
              }
            );
          }
        });
      }
    );

  return domain;
}
