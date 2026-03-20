import { Command } from "commander";
import chalk from "chalk";
import { fetchComposeDeploymentPlan } from "../compose-deploy-preview";
import { printComposeDeploymentPlan } from "../compose-deployment-plan-output";
import { loadDaoflowConfig } from "../config-loader";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { printDeploymentPlan } from "../deployment-plan-output";
import { createClient } from "../trpc-client";

const PLAN_HELP_TEXT = [
  "",
  "Target rules:",
  "  Provide exactly one of --service or --compose.",
  "  Compose planning also requires --server.",
  "",
  "Required scope:",
  "  deploy:read",
  "",
  "Examples:",
  "  daoflow plan --service svc_123",
  "  daoflow plan --compose ./compose.yaml --server srv_123",
  "  daoflow plan --compose ./compose.yaml --server srv_123 --json",
  "",
  "Example JSON shape:",
  '  { "ok": true, "data": { "isReady": true, "steps": ["..."], "executeCommand": "..." } }'
].join("\n");

export function planCommand(): Command {
  return new Command("plan")
    .description("Preview a deployment plan without executing it")
    .option("--service <id>", "Service name or ID")
    .option("--compose <path>", "Docker Compose file path")
    .option(
      "--compose-override <path>",
      "Additional Docker Compose override file, applied after --compose",
      (value: string, previous: string[] = []) => [...previous, value],
      []
    )
    .option(
      "--profile <name>",
      "Compose profile to enable",
      (value: string, previous: string[] = []) => [...previous, value],
      []
    )
    .option("--context <path>", "Build context path (default: .)")
    .option("--server <id>", "Target server")
    .option("--image <tag>", "Image tag to deploy")
    .option("--json", "Output as JSON")
    .addHelpText("after", PLAN_HELP_TEXT)
    .action(
      async (
        opts: {
          service?: string;
          compose?: string;
          composeOverride?: string[];
          profile?: string[];
          context?: string;
          server?: string;
          image?: string;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);
        const configResult = loadDaoflowConfig();
        const cfg = configResult?.config;
        if (configResult && !isJson) {
          console.error(chalk.dim(`  Using config: ${configResult.filePath}`));
        }

        const serviceId = opts.service;
        const composePath = opts.compose ?? (serviceId ? undefined : cfg?.compose);
        const composeOverrides =
          opts.composeOverride && opts.composeOverride.length > 0
            ? opts.composeOverride
            : (cfg?.composeOverrides ?? []);
        const composeProfiles =
          opts.profile && opts.profile.length > 0 ? opts.profile : (cfg?.composeProfiles ?? []);
        const contextPath = opts.context ?? cfg?.context ?? ".";
        const serverId = opts.server ?? cfg?.server;

        if (serviceId && opts.compose) {
          const error = "Choose either --service or --compose, not both.";
          if (isJson) {
            emitJsonError(error, "INVALID_INPUT");
          } else {
            console.error(chalk.red(`✗ ${error}`));
          }
          process.exit(1);
          return;
        }

        if (!serviceId && !composePath) {
          const error = "Either --service or --compose is required.";
          if (isJson) {
            emitJsonError(error, "INVALID_INPUT");
          } else {
            console.error(chalk.red(`✗ ${error}`));
          }
          process.exit(1);
          return;
        }

        if (!serviceId && composePath && !serverId) {
          const error = "--server is required for compose planning.";
          if (isJson) {
            emitJsonError(error, "INVALID_INPUT");
          } else {
            console.error(chalk.red(`✗ ${error}`));
          }
          process.exit(1);
          return;
        }

        try {
          if (serviceId) {
            const trpc = createClient();
            const plan = await trpc.deploymentPlan.query({
              service: serviceId,
              server: serverId,
              image: opts.image
            });

            if (isJson) {
              emitJsonSuccess(plan);
              return;
            }

            printDeploymentPlan(plan, { subtitle: "This plan will NOT be executed." });
            return;
          }

          if (composePath) {
            const composeServerId = serverId;
            if (!composeServerId) {
              throw new Error("--server is required for compose planning.");
            }

            const trpc = createClient();
            const plan = await fetchComposeDeploymentPlan(trpc, {
              composePath,
              composeOverrides,
              composeProfiles,
              contextPath,
              serverId: composeServerId,
              json: isJson,
              config: cfg
            });

            if (isJson) {
              emitJsonSuccess(plan);
              return;
            }

            printComposeDeploymentPlan(plan, {
              title: "Compose Deployment Plan",
              subtitle: "This plan will NOT be executed."
            });
            return;
          }
        } catch (error) {
          if (isJson) {
            emitJsonError(getErrorMessage(error), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      }
    );
}
