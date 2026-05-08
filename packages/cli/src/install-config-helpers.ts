import type { Command } from "commander";
import { CLOUDFLARE_TUNNEL_TOKEN_ENV } from "./install-cloudflare";
import {
  describeDashboardExposureMode,
  type DashboardExposureMode
} from "./install-exposure-state";
import type { DatabasePasswordMode, InstallOptionSources } from "./install-config-types";
import type { ExistingInstallState } from "./installer-lifecycle";

export function buildInstallOptionSources(command: Command): InstallOptionSources {
  return {
    hasExplicitDomain: command.getOptionValueSource("domain") === "cli",
    hasExplicitPort: command.getOptionValueSource("port") === "cli",
    hasExplicitExpose: command.getOptionValueSource("expose") === "cli",
    hasExplicitAcmeEmail: command.getOptionValueSource("acmeEmail") === "cli",
    hasExplicitCloudflareTunnel: command.getOptionValueSource("cloudflareTunnel") === "cli",
    hasExplicitCloudflareTunnelToken:
      command.getOptionValueSource("cloudflareTunnelToken") === "cli"
  };
}

export function printInstallSummary(input: {
  dir: string;
  domain: string;
  port: number;
  email: string;
  databasePasswordMode: DatabasePasswordMode;
  exposureMode: DashboardExposureMode;
  cloudflareTunnelEnabled: boolean;
  acmeEmail?: string;
}): void {
  console.error();
  console.error("Configuration:");
  console.error(`  Directory:     ${input.dir}`);
  console.error(`  Domain:        ${input.domain}`);
  console.error(`  Port:          ${String(input.port)}`);
  console.error(`  Admin:         ${input.email}`);
  console.error(`  DB Passwords:  ${input.databasePasswordMode}`);
  console.error(`  Exposure:      ${describeDashboardExposureMode(input.exposureMode)}`);
  console.error(`  CF Tunnel:     ${input.cloudflareTunnelEnabled ? "enabled" : "disabled"}`);
  if (input.acmeEmail) {
    console.error(`  ACME Email:    ${input.acmeEmail}`);
  }
  if (input.cloudflareTunnelEnabled) {
    console.error(`  CF Token:      ${CLOUDFLARE_TUNNEL_TOKEN_ENV}`);
  }
  if (input.exposureMode !== "none" || input.cloudflareTunnelEnabled) {
    console.error(
      "  Note: BETTER_AUTH_URL will be updated to the exposed HTTPS URL if setup succeeds."
    );
  }
  console.error();
}

export function resolveInstallScheme(
  domain: string,
  existingInstall: ExistingInstallState | null
): "http" | "https" {
  if (existingInstall?.scheme) {
    return existingInstall.scheme;
  }

  return domain === "localhost" ? "http" : "https";
}

export function requireInstallValue<T>(
  value: T | null | undefined,
  onMissing: () => never
): Exclude<T, null | undefined> {
  if (value === null || value === undefined) {
    return onMissing();
  }

  return value as Exclude<T, null | undefined>;
}
