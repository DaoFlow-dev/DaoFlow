import type { InstallConfiguration } from "./install-config-types";
import { type InstallerRuntime, writeInstallFile } from "./installer-lifecycle";
import {
  removeTemporalInstallServices,
  type InstallWorkflowProfilePlan
} from "./install-workflow-runtime";
import { generateEnvFile, parseEnvFile } from "./templates";

export class InstallEnvironmentPreparationError extends Error {
  constructor(
    message: string,
    readonly code: "MISSING_TEMPORAL_POSTGRES_PASSWORD"
  ) {
    super(message);
  }
}

export function buildInstallEnvironment(input: { config: InstallConfiguration; version: string }): {
  contents: string;
  missingTemporalDatabasePassword: boolean;
} {
  const { config } = input;
  const contents = generateEnvFile({
    version: input.version,
    domain: config.domain,
    port: config.port,
    scheme: config.scheme,
    exposureMode: config.exposureMode,
    cloudflareTunnelEnabled: config.cloudflareTunnelEnabled,
    cloudflareTunnelToken: config.cloudflareTunnelToken,
    acmeEmail: config.acmeEmail,
    initialAdminEmail: config.email,
    initialAdminPassword: config.password,
    postgresPassword: config.postgresPassword,
    temporalPostgresPassword: config.temporalPostgresPassword,
    workflowProfile: config.workflowProfile,
    authSecret: config.existingInstall?.env.BETTER_AUTH_SECRET,
    encryptionKey: config.existingInstall?.env.ENCRYPTION_KEY,
    recoveryEncryptionKey: config.existingInstall?.env.DAOFLOW_RECOVERY_ENCRYPTION_KEY,
    preservedEnv: config.existingInstall?.env
  });

  return {
    contents,
    missingTemporalDatabasePassword:
      config.workflowProfile === "temporal" &&
      !parseEnvFile(contents).TEMPORAL_POSTGRES_PASSWORD?.trim()
  };
}

export function persistInstallEnvironment(input: {
  runtime: Pick<InstallerRuntime, "exec">;
  dir: string;
  envPath: string;
  contents: string;
  workflowProfilePlan: InstallWorkflowProfilePlan | null;
}): { skippedTemporalCleanup: boolean } {
  const skippedTemporalCleanup = input.workflowProfilePlan?.change === "temporal-to-lean";
  if (skippedTemporalCleanup) {
    removeTemporalInstallServices({
      runtime: input.runtime,
      dir: input.dir,
      envPath: input.envPath
    });
  }

  writeInstallFile(input.envPath, input.contents);
  return { skippedTemporalCleanup };
}

export function prepareInstallEnvironment(input: {
  config: InstallConfiguration;
  version: string;
}): { envContent: string } {
  const environment = buildInstallEnvironment({
    config: input.config,
    version: input.version
  });
  if (environment.missingTemporalDatabasePassword) {
    throw new InstallEnvironmentPreparationError(
      "Temporal workflow profile requires a non-empty TEMPORAL_POSTGRES_PASSWORD before services can start.",
      "MISSING_TEMPORAL_POSTGRES_PASSWORD"
    );
  }

  return { envContent: environment.contents };
}
