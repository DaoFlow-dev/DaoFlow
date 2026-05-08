import type { Command } from "commander";
import type { CommandActionContext } from "./command-action";
import type { DashboardExposureMode } from "./install-exposure-state";
import type { ExistingInstallState, InstallerRuntime } from "./installer-lifecycle";

export interface InstallOptions {
  dir: string;
  domain?: string;
  port: string;
  acmeEmail?: string;
  email?: string;
  password?: string;
  expose?: string;
  cloudflareTunnel?: boolean;
  cloudflareTunnelToken?: string;
  yes?: boolean;
  json?: boolean;
}

export type DatabasePasswordMode = "auto-generated" | "manual" | "preserved";

export interface InstallConfiguration {
  dir: string;
  domain: string;
  port: number;
  scheme: "http" | "https";
  email: string;
  password: string;
  acmeEmail?: string;
  postgresPassword?: string;
  temporalPostgresPassword?: string;
  existingInstall: ExistingInstallState | null;
  databasePasswordMode: DatabasePasswordMode;
  exposureMode: DashboardExposureMode;
  cloudflareTunnelEnabled: boolean;
  cloudflareTunnelToken?: string;
  exposureRequestedExplicitly: boolean;
}

export type InstallConfigurationResult =
  | ({ cancelled: true } & Partial<InstallConfiguration>)
  | ({ cancelled: false } & InstallConfiguration);

export interface InstallOptionSources {
  hasExplicitDomain: boolean;
  hasExplicitPort: boolean;
  hasExplicitExpose: boolean;
  hasExplicitAcmeEmail: boolean;
  hasExplicitCloudflareTunnel: boolean;
  hasExplicitCloudflareTunnelToken: boolean;
}

export interface CollectInstallConfigurationInput {
  options: InstallOptions;
  command: Command;
  ctx: CommandActionContext;
  runtime: Pick<InstallerRuntime, "prompt" | "promptSelect">;
}
