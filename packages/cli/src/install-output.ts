import chalk from "chalk";
import type { CommandActionError } from "./command-action";
import {
  describeDashboardExposureMode,
  type DashboardExposureMode,
  type DashboardExposureResult
} from "./install-exposure-state";
import type { InstallWorkflowProfilePlan } from "./install-workflow-runtime";

export function buildInstallErrorPayload(error: CommandActionError): Record<string, unknown> {
  return { ...(error.extra ?? {}), ok: false, error: error.message, code: error.code };
}

export function emitInstallError(error: CommandActionError, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(buildInstallErrorPayload(error)));
    return;
  }

  if (error.code === "DOCKER_NOT_FOUND") {
    console.error(chalk.red("\nDocker is required. Install it first:"));
    console.error(chalk.dim("  https://docs.docker.com/engine/install/"));
    console.error(chalk.dim("  Or: curl -fsSL https://get.docker.com | sh"));
    return;
  }

  console.error(chalk.red(error.humanMessage ?? error.message));
}

export function emitInstallWorkflowProfilePlan(input: {
  plan: InstallWorkflowProfilePlan;
  json: boolean;
}): void {
  if (input.json) {
    console.error(
      JSON.stringify({
        ok: true,
        event: "workflow-profile-plan",
        data: { workflowProfilePlan: input.plan }
      })
    );
    return;
  }

  console.error();
  console.error("Workflow profile change plan:");
  console.error(`  From:              ${input.plan.from}`);
  console.error(`  To:                ${input.plan.to}`);
  console.error(`  Services to add:   ${input.plan.services.added.join(", ") || "none"}`);
  console.error(`  Services to remove: ${input.plan.services.removed.join(", ") || "none"}`);
  console.error(`  Volumes preserved: ${input.plan.preservedVolumes.join(", ")}`);
  console.error();
}

export function renderInstallSuccess(input: {
  displayUrl: string;
  directory: string;
  version: string;
  email: string;
  exposureMode: DashboardExposureMode;
  exposure: DashboardExposureResult;
  cloudflareTunnel?: {
    publicUrl: string;
    guide: string[];
  };
}): void {
  console.error();
  console.error(chalk.green.bold("✅ DaoFlow installed successfully!"));
  console.error();
  console.error(`  Dashboard:  ${chalk.cyan(input.displayUrl)}`);
  console.error(`  Directory:  ${chalk.dim(input.directory)}`);
  console.error(`  Version:    ${chalk.dim(input.version)}`);
  if (input.exposureMode !== "none") {
    console.error(`  Exposure:   ${chalk.dim(describeDashboardExposureMode(input.exposureMode))}`);
    if (input.exposure.detail && !input.exposure.ok) {
      console.error(`  Warning:    ${chalk.yellow(input.exposure.detail)}`);
    }
  }
  if (input.cloudflareTunnel) {
    console.error(`  CF Tunnel:  ${chalk.dim(input.cloudflareTunnel.publicUrl)}`);
  }
  console.error();
  console.error(chalk.bold("Next steps:"));
  console.error(
    input.cloudflareTunnel
      ? `  1. Finish the Cloudflare hostname mapping below, then open ${chalk.cyan(input.displayUrl)} and sign in as ${chalk.cyan(input.email)}`
      : `  1. Open ${chalk.cyan(input.displayUrl)} and sign in as ${chalk.cyan(input.email)}`
  );
  console.error("  2. Register your first server");
  console.error("  3. Deploy your first application");
  console.error();
  console.error(chalk.bold("Useful commands:"));
  console.error(`  ${chalk.dim("daoflow doctor --json")}   Check system health`);
  console.error(`  ${chalk.dim("daoflow upgrade --yes")}   Upgrade to latest version`);
  console.error(`  ${chalk.dim(`cd ${input.directory} && docker compose logs -f`)}  View logs`);
  if (input.exposureMode === "traefik") {
    console.error(
      `  ${chalk.dim("DNS note:")}  If HTTPS is not ready yet, confirm your domain points to this server and check Traefik logs.`
    );
  }
  if (input.cloudflareTunnel) {
    console.error(chalk.bold("Cloudflare Tunnel guide:"));
    for (const [index, step] of input.cloudflareTunnel.guide.entries()) {
      console.error(`  ${index + 1}. ${step}`);
    }
    console.error(
      `  ${chalk.dim(`cd ${input.directory} && docker compose logs -f cloudflared`)}  Watch Cloudflare tunnel logs`
    );
  }
  if (input.exposure.logPath) {
    console.error(`  ${chalk.dim(`tail -f ${input.exposure.logPath}`)}  Watch tunnel logs`);
  }
  console.error();
}
