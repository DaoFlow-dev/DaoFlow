import chalk from "chalk";
import {
  describeDashboardExposureMode,
  type DashboardExposureMode,
  type DashboardExposureResult
} from "./install-exposure-state";

export function renderInstallSuccess(input: {
  displayUrl: string;
  directory: string;
  version: string;
  email: string;
  exposureMode: DashboardExposureMode;
  exposure: DashboardExposureResult;
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
  console.error();
  console.error(chalk.bold("Next steps:"));
  console.error(
    `  1. Open ${chalk.cyan(input.displayUrl)} and sign in as ${chalk.cyan(input.email)}`
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
  if (input.exposure.logPath) {
    console.error(`  ${chalk.dim(`tail -f ${input.exposure.logPath}`)}  Watch tunnel logs`);
  }
  console.error();
}
