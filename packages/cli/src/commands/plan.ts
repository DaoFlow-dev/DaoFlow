import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeComposeInputs } from "../compose-input-analysis";
import { fetchComposeDeploymentPlan } from "../compose-deploy-preview";
import { printComposeDeploymentPlan } from "../compose-deployment-plan-output";
import { loadDaoflowConfig } from "../config-loader";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  normalizeCliInput,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import {
  assertValidComposeUploadContextRoot,
  ComposeUploadContextValidationError
} from "../compose-upload-context";
import { printDeploymentPlan } from "../deployment-plan-output";
import { buildServicePreviewTarget } from "../service-preview-target";
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
  "  daoflow plan --service svc_123 --preview-branch feature/login --preview-pr 42",
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
    .option("--context <path>", "Upload root for compose-local inputs (default: .)")
    .option("--server <id>", "Target server")
    .option("--image <tag>", "Image tag to deploy")
    .option("--preview-branch <branch>", "Target a compose preview for a source branch")
    .option("--preview-pr <number>", "Associate the preview with a pull request number")
    .option("--preview-close", "Plan preview stack cleanup instead of deploy")
    .option("--json", "Output as JSON")
    .addHelpText("after", PLAN_HELP_TEXT)
    .action(
      async (
        opts: {
          service?: string;
          compose?: string;
          context?: string;
          server?: string;
          image?: string;
          previewBranch?: string;
          previewPr?: string;
          previewClose?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        await withResolvedCommandRequestOptions(command, async () => {
          const configResult = loadDaoflowConfig();
          const cfg = configResult?.config;
          if (configResult && !isJson) {
            console.error(chalk.dim(`  Using config: ${configResult.filePath}`));
          }

          const serviceId = opts.service;
          const composePath = opts.compose ?? (serviceId ? undefined : cfg?.compose);
          const contextPath = normalizeCliInput(
            opts.context ?? cfg?.context ?? ".",
            "Context path",
            {
              allowPathTraversal: true,
              maxLength: 1024
            }
          );
          const serverId = opts.server ?? cfg?.server;
          const previewTargetResult = buildServicePreviewTarget({
            previewBranch: opts.previewBranch,
            previewPr: opts.previewPr,
            previewClose: opts.previewClose
          });
          if (previewTargetResult.error) {
            if (isJson) {
              emitJsonError(previewTargetResult.error, "INVALID_INPUT");
            } else {
              console.error(chalk.red(`✗ ${previewTargetResult.error}`));
            }
            process.exit(1);
            return;
          }
          const previewTarget = previewTargetResult.preview;

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

          if (composePath && previewTarget) {
            const error = "Preview targeting is only supported with --service planning.";
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
                image: opts.image,
                preview: previewTarget
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

              const normalizedComposePath = normalizeCliInput(composePath, "Compose path", {
                allowPathTraversal: true,
                maxLength: 1024
              });
              const resolvedComposePath = resolve(normalizedComposePath);
              if (!existsSync(resolvedComposePath)) {
                const error = `Compose file not found: ${normalizedComposePath}`;
                if (isJson) {
                  emitJsonError(error, "FILE_NOT_FOUND");
                } else {
                  console.error(chalk.red(`✗ ${error}`));
                }
                process.exit(1);
                return;
              }

              const composeContent = readFileSync(resolvedComposePath, "utf8");
              const composeInputs = analyzeComposeInputs(composeContent);
              assertValidComposeUploadContextRoot({
                composePath: resolvedComposePath,
                contextPath,
                composeInputs
              });

              const trpc = createClient();
              const plan = await fetchComposeDeploymentPlan(trpc, {
                composePath: normalizedComposePath,
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
            if (error instanceof ComposeUploadContextValidationError) {
              if (isJson) {
                emitJsonError(getErrorMessage(error), "INVALID_INPUT");
              } else {
                console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
              }
              process.exit(1);
              return;
            }

            if (isJson) {
              emitJsonError(getErrorMessage(error), "API_ERROR");
            } else {
              console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
            }
            process.exit(1);
          }
        });
      }
    );
}
