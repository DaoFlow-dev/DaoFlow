import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import {
  getErrorMessage,
  normalizeCliInput,
  normalizeOptionalCliInput,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient } from "../trpc-client";

type ServiceSourceType = "compose" | "dockerfile" | "image";

function formatFlagList(flags: string[]): string {
  if (flags.length === 1) {
    return flags[0] ?? "";
  }

  if (flags.length === 2) {
    return `${flags[0]} or ${flags[1]}`;
  }

  return `${flags.slice(0, -1).join(", ")}, or ${flags.at(-1)}`;
}

function isServiceSourceType(value: string): value is ServiceSourceType {
  return value === "compose" || value === "dockerfile" || value === "image";
}

function buildServiceNextSteps(serviceId: string) {
  return {
    plan: {
      command: `daoflow plan --service ${serviceId}`,
      description: "Preview the rollout steps and preflight checks for this service."
    },
    deploy: {
      command: `daoflow deploy --service ${serviceId} --yes`,
      description: "Queue the first deployment when the plan looks correct."
    }
  };
}

function stripUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

function validateCreateOptions(input: {
  sourceType: ServiceSourceType;
  composeServiceName?: string;
  dockerfilePath?: string;
  imageReference?: string;
}): string | null {
  const providedFlags = [
    input.composeServiceName ? "--compose-service" : null,
    input.dockerfilePath ? "--dockerfile" : null,
    input.imageReference ? "--image" : null
  ].filter((flag): flag is string => flag !== null);

  if (input.sourceType === "compose") {
    if (!input.composeServiceName) {
      return "Compose services require --compose-service.";
    }

    const disallowed = providedFlags.filter((flag) => flag !== "--compose-service");
    if (disallowed.length > 0) {
      return `Compose services cannot use ${formatFlagList(disallowed)}.`;
    }
    return null;
  }

  if (input.sourceType === "dockerfile") {
    if (!input.dockerfilePath) {
      return "Dockerfile services require --dockerfile.";
    }

    const disallowed = providedFlags.filter((flag) => flag !== "--dockerfile");
    if (disallowed.length > 0) {
      return `Dockerfile services cannot use ${formatFlagList(disallowed)}.`;
    }
    return null;
  }

  if (!input.imageReference) {
    return "Image services require --image.";
  }

  const disallowed = providedFlags.filter((flag) => flag !== "--image");
  if (disallowed.length > 0) {
    return `Image services cannot use ${formatFlagList(disallowed)}.`;
  }

  return null;
}

function colorizeTone(tone: string, value: string) {
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

export function servicesCommand(): Command {
  const services = new Command("services").description("Manage services and view runtime status");

  services
    .command("list")
    .alias("ls")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Filter by project ID")
    .description("List services and their runtime status")
    .action(async (opts: { json?: boolean; project?: string }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      await withResolvedCommandRequestOptions(command, async () => {
        try {
          const trpc = createClient();
          const services = opts.project
            ? await trpc.projectServices.query({ projectId: opts.project })
            : await trpc.services.query({});

          if (isJson) {
            console.log(
              JSON.stringify({ ok: true, data: { projectId: opts.project ?? null, services } })
            );
            return;
          }

          console.log(chalk.bold("\n  Services\n"));

          if (!services.length) {
            console.log(chalk.dim("  No services found.\n"));
            return;
          }

          const header = `  ${"SERVICE".padEnd(22)} ${"RUNTIME".padEnd(18)} ${"STRATEGY".padEnd(20)} ${"SERVER".padEnd(18)} ${"IMAGE".padEnd(28)}`;
          console.log(chalk.dim(header));
          console.log(chalk.dim("  " + "─".repeat(112)));

          for (const svc of services) {
            const runtimeLabel = svc.runtimeSummary.statusLabel.padEnd(18);
            const targetServer = svc.latestDeployment?.targetServerName ?? "—";
            const imageRef = svc.latestDeployment?.imageTag ?? svc.imageReference ?? "—";

            console.log(
              `  ${svc.name.padEnd(22)} ${colorizeTone(svc.runtimeSummary.statusTone, runtimeLabel)} ${svc.rolloutStrategy.label.padEnd(20)} ${targetServer.padEnd(18)} ${imageRef.padEnd(28)}`
            );
            console.log(chalk.dim(`    ${svc.runtimeSummary.summary}`));
            console.log(
              chalk.dim(
                `    Strategy: ${svc.rolloutStrategy.summary} Downtime risk: ${svc.rolloutStrategy.downtimeRisk}.`
              )
            );
          }
          console.log();
        } catch (error) {
          if (isJson) {
            console.log(
              JSON.stringify({ ok: false, error: getErrorMessage(error), code: "API_ERROR" })
            );
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      });
    });

  services
    .command("create")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--environment <id>", "Environment ID")
    .requiredOption("--name <name>", "Service name")
    .requiredOption("--source-type <type>", "Service source type (compose|dockerfile|image)")
    .option("--compose-service <name>", "Compose service name when --source-type compose")
    .option("--dockerfile <path>", "Dockerfile path when --source-type dockerfile")
    .option("--image <ref>", "Container image reference when --source-type image")
    .option("--server <id>", "Target server ID override")
    .option("--port <value>", "Primary service port")
    .option("--healthcheck-path <path>", "HTTP healthcheck path")
    .option("--dry-run", "Preview the service payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Create a service inside a project environment")
    .action(
      async (
        opts: {
          project: string;
          environment: string;
          name: string;
          sourceType: string;
          composeService?: string;
          dockerfile?: string;
          image?: string;
          server?: string;
          port?: string;
          healthcheckPath?: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const normalizedSourceType = normalizeCliInput(opts.sourceType, "Source type");
            if (!isServiceSourceType(normalizedSourceType)) {
              return ctx.fail("Source type must be one of: compose, dockerfile, image.", {
                code: "INVALID_INPUT"
              });
            }
            const resolvedSourceType: ServiceSourceType = normalizedSourceType;

            const payload = {
              projectId: normalizeCliInput(opts.project, "Project ID"),
              environmentId: normalizeCliInput(opts.environment, "Environment ID"),
              name: normalizeCliInput(opts.name, "Service name", { maxLength: 80 }),
              sourceType: resolvedSourceType,
              composeServiceName: normalizeOptionalCliInput(
                opts.composeService,
                "Compose service name",
                { maxLength: 100 }
              ),
              dockerfilePath: normalizeOptionalCliInput(opts.dockerfile, "Dockerfile path", {
                maxLength: 500
              }),
              imageReference: normalizeOptionalCliInput(opts.image, "Image reference", {
                maxLength: 255
              }),
              targetServerId: normalizeOptionalCliInput(opts.server, "Target server ID"),
              port: normalizeOptionalCliInput(opts.port, "Port", { maxLength: 20 }),
              healthcheckPath: normalizeOptionalCliInput(opts.healthcheckPath, "Healthcheck path", {
                maxLength: 255
              })
            };

            const validationError = validateCreateOptions(payload);
            if (validationError) {
              ctx.fail(validationError, { code: "INVALID_INPUT" });
            }

            if (opts.dryRun) {
              const dryRunPayload = stripUndefinedValues({
                dryRun: true,
                ...payload
              });

              return ctx.dryRun(dryRunPayload, {
                human: () => {
                  console.log(chalk.bold(`\n  Dry-run: create service ${payload.name}\n`));
                  console.log(`  Project:      ${payload.projectId}`);
                  console.log(`  Environment:  ${payload.environmentId}`);
                  console.log(`  Source type:  ${payload.sourceType}`);
                  if (payload.composeServiceName) {
                    console.log(`  Compose svc:  ${payload.composeServiceName}`);
                  }
                  if (payload.dockerfilePath) {
                    console.log(`  Dockerfile:   ${payload.dockerfilePath}`);
                  }
                  if (payload.imageReference) {
                    console.log(`  Image:        ${payload.imageReference}`);
                  }
                  if (payload.targetServerId) {
                    console.log(`  Server:       ${payload.targetServerId}`);
                  }
                  if (payload.port) {
                    console.log(`  Port:         ${payload.port}`);
                  }
                  if (payload.healthcheckPath) {
                    console.log(`  Healthcheck:  ${payload.healthcheckPath}`);
                  }
                  console.log();
                }
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create service ${payload.name} in environment ${payload.environmentId}. Pass --yes to confirm.`,
              {
                humanMessage: `Create service ${payload.name} in environment ${payload.environmentId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const service = await trpc.createService.mutate({
              projectId: payload.projectId,
              environmentId: payload.environmentId,
              name: payload.name,
              sourceType: payload.sourceType,
              composeServiceName: payload.composeServiceName,
              dockerfilePath: payload.dockerfilePath,
              imageReference: payload.imageReference,
              targetServerId: payload.targetServerId,
              port: payload.port,
              healthcheckPath: payload.healthcheckPath
            });
            const nextSteps = buildServiceNextSteps(service.id);

            return ctx.success(
              {
                service: {
                  id: service.id,
                  projectId: service.projectId,
                  environmentId: service.environmentId,
                  name: service.name,
                  sourceType: service.sourceType,
                  status: service.status
                },
                nextSteps
              },
              {
                quiet: () => service.id,
                human: () => {
                  console.log(chalk.green(`✓ Created service ${service.name} (${service.id})`));
                  console.log(chalk.dim(`  Project: ${service.projectId}`));
                  console.log(chalk.dim(`  Environment: ${service.environmentId}`));
                  console.log(chalk.dim(`  Next: ${nextSteps.plan.command}`));
                  console.log(chalk.dim(`        ${nextSteps.deploy.command}`));
                  console.log();
                }
              }
            );
          }
        });
      }
    );

  return services;
}
