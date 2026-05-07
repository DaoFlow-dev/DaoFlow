import {
  readComposeReadinessProbeFromConfig,
  type ComposeReadinessProbeInput,
  writeComposeReadinessProbeToConfig
} from "../../compose-readiness";
import {
  readComposePreviewConfigFromConfig,
  type ComposePreviewConfigInput,
  writeComposePreviewConfigToConfig
} from "../../compose-preview";
import {
  type ManagedDatabaseConfigInput,
  writeManagedDatabaseConfigToConfig
} from "../../managed-database-config";
export interface ServiceConfigValidationInput {
  sourceType: "compose" | "dockerfile" | "image";
  healthcheckPath?: string | null;
  readinessProbe?: ComposeReadinessProbeInput | null;
  preview?: ComposePreviewConfigInput | null;
  managedDatabase?: ManagedDatabaseConfigInput | null;
}

type ServiceConfig = Record<string, unknown>;

function asConfigRecord(value: unknown): ServiceConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ServiceConfig)
    : {};
}

export function validateServiceConfigInput(input: ServiceConfigValidationInput) {
  if (input.readinessProbe && input.sourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Explicit readiness probes are only supported for compose services."
    };
  }

  if (input.healthcheckPath && input.sourceType === "compose" && !input.readinessProbe) {
    return {
      status: "invalid_config" as const,
      message:
        "Compose services no longer accept healthcheckPath. Configure service.config.readinessProbe instead."
    };
  }

  if (input.preview?.enabled === true && input.sourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Preview deployments are only supported for compose services."
    };
  }

  return null;
}

export function buildInitialServiceConfig(input: {
  readinessProbe?: ComposeReadinessProbeInput | null;
  preview?: ComposePreviewConfigInput | null;
  managedDatabase?: ManagedDatabaseConfigInput | null;
}): ServiceConfig {
  return writeManagedDatabaseConfigToConfig({
    config: writeComposePreviewConfigToConfig({
      config: writeComposeReadinessProbeToConfig({
        config: {},
        readinessProbe: input.readinessProbe
      }),
      preview: input.preview
    }),
    managedDatabase: input.managedDatabase
  });
}

export function buildUpdatedServiceConfig(input: {
  existingConfig: unknown;
  nextSourceType: "compose" | "dockerfile" | "image";
  readinessProbe?: ComposeReadinessProbeInput | null;
  preview?: ComposePreviewConfigInput | null;
  managedDatabase?: ManagedDatabaseConfigInput | null;
}): ServiceConfig | undefined {
  let nextConfig = asConfigRecord(input.existingConfig);
  let changed = false;

  if (input.readinessProbe !== undefined) {
    nextConfig = writeComposeReadinessProbeToConfig({
      config: nextConfig,
      readinessProbe: input.readinessProbe
    });
    changed = true;
  }

  if (input.preview !== undefined) {
    nextConfig = writeComposePreviewConfigToConfig({
      config: nextConfig,
      preview: input.preview
    });
    changed = true;
  }

  if (input.managedDatabase !== undefined) {
    nextConfig = writeManagedDatabaseConfigToConfig({
      config: nextConfig,
      managedDatabase: input.managedDatabase
    });
    changed = true;
  }

  if (input.nextSourceType !== "compose" && readComposeReadinessProbeFromConfig(nextConfig)) {
    nextConfig = writeComposeReadinessProbeToConfig({
      config: nextConfig,
      readinessProbe: null
    });
    changed = true;
  }

  if (input.nextSourceType !== "compose" && readComposePreviewConfigFromConfig(nextConfig)) {
    nextConfig = writeComposePreviewConfigToConfig({
      config: nextConfig,
      preview: null
    });
    changed = true;
  }

  if (input.nextSourceType !== "compose") {
    nextConfig = writeManagedDatabaseConfigToConfig({
      config: nextConfig,
      managedDatabase: null
    });
    changed = true;
  }

  return changed ? nextConfig : undefined;
}
