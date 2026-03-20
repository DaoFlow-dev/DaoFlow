import type {
  ComposeBuildPlan,
  ComposeBuildPlanAdditionalContext,
  ComposeBuildPlanArg,
  ComposeBuildPlanSecret,
  ComposeBuildPlanService
} from "./compose-build-plan-types";
import { buildComposeGraph } from "./compose-build-plan-graph";
import {
  classifyBuildReference,
  readObject,
  readServices,
  readTopLevelSecrets
} from "./compose-build-plan-shared";

function inferArgSource(value: unknown): ComposeBuildPlanArg["source"] {
  if (value === undefined || value === null) {
    return "implicit";
  }

  if (typeof value === "string") {
    return /\$\{|\$[A-Za-z_]/.test(value) ? "interpolated" : "literal";
  }

  return "literal";
}

function buildArgsPlan(value: unknown): ComposeBuildPlanArg[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry !== "string") {
        return [];
      }

      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return [
          {
            key: entry.trim(),
            source: "implicit"
          }
        ];
      }

      return [
        {
          key: entry.slice(0, separatorIndex).trim(),
          source: inferArgSource(entry.slice(separatorIndex + 1))
        }
      ];
    });
  }

  const record = readObject(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .map(([key, entryValue]) => ({
      key,
      source: inferArgSource(entryValue)
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildAdditionalContextsPlan(value: unknown): ComposeBuildPlanAdditionalContext[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry !== "string") {
        return [];
      }

      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return [];
      }

      const name = entry.slice(0, separatorIndex).trim();
      const contextValue = entry.slice(separatorIndex + 1).trim();
      return [
        {
          name,
          value: contextValue,
          type: classifyBuildReference(contextValue)
        }
      ];
    });
  }

  const record = readObject(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .flatMap(([name, entryValue]) =>
      typeof entryValue === "string"
        ? [
            {
              name,
              value: entryValue,
              type: classifyBuildReference(entryValue)
            } satisfies ComposeBuildPlanAdditionalContext
          ]
        : []
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveSecretMetadata(
  topLevelSecrets: Record<string, unknown>,
  sourceName: string
): Pick<ComposeBuildPlanSecret, "provider" | "reference"> {
  const secret = readObject(topLevelSecrets[sourceName]);
  if (!secret) {
    return {
      provider: "unknown",
      reference: null
    };
  }

  if (typeof secret.file === "string") {
    return {
      provider: "file",
      reference: secret.file
    };
  }

  if (typeof secret.environment === "string") {
    return {
      provider: "environment",
      reference: secret.environment
    };
  }

  if (secret.external === true || readObject(secret.external)) {
    return {
      provider: "external",
      reference: typeof secret.name === "string" ? secret.name : sourceName
    };
  }

  return {
    provider: "unknown",
    reference: null
  };
}

function buildSecretsPlan(
  value: unknown,
  topLevelSecrets: Record<string, unknown>
): ComposeBuildPlanSecret[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        const resolved = resolveSecretMetadata(topLevelSecrets, entry);
        return [
          {
            sourceName: entry,
            ...resolved,
            target: null
          } satisfies ComposeBuildPlanSecret
        ];
      }

      const record = readObject(entry);
      if (!record) {
        return [];
      }

      const sourceName =
        typeof record.source === "string"
          ? record.source
          : typeof record.secret === "string"
            ? record.secret
            : null;
      if (!sourceName) {
        return [];
      }

      const resolved = resolveSecretMetadata(topLevelSecrets, sourceName);
      return [
        {
          sourceName,
          ...resolved,
          target: typeof record.target === "string" ? record.target : null
        } satisfies ComposeBuildPlanSecret
      ];
    })
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function buildServicePlan(input: {
  serviceName: string;
  service: Record<string, unknown>;
  topLevelSecrets: Record<string, unknown>;
}): ComposeBuildPlanService | null {
  const build = input.service.build;
  if (!build) {
    return null;
  }

  if (typeof build === "string") {
    return {
      serviceName: input.serviceName,
      context: build,
      contextType: classifyBuildReference(build),
      image: typeof input.service.image === "string" ? input.service.image : null,
      dockerfile: null,
      target: null,
      args: [],
      additionalContexts: [],
      secrets: []
    };
  }

  const buildRecord = readObject(build);
  if (!buildRecord) {
    return null;
  }

  const context = typeof buildRecord.context === "string" ? buildRecord.context : ".";

  return {
    serviceName: input.serviceName,
    context,
    contextType: classifyBuildReference(context),
    image: typeof input.service.image === "string" ? input.service.image : null,
    dockerfile: typeof buildRecord.dockerfile === "string" ? buildRecord.dockerfile : null,
    target: typeof buildRecord.target === "string" ? buildRecord.target : null,
    args: buildArgsPlan(buildRecord.args),
    additionalContexts: buildAdditionalContextsPlan(buildRecord.additional_contexts),
    secrets: buildSecretsPlan(buildRecord.secrets, input.topLevelSecrets)
  };
}

export function buildComposeBuildPlan(
  doc: Record<string, unknown>,
  warnings: string[] = []
): ComposeBuildPlan {
  const normalizedWarnings = [...warnings];
  const services = readServices(doc);
  const topLevelSecrets = readTopLevelSecrets(doc);
  const graph = buildComposeGraph({
    doc,
    warnings: normalizedWarnings
  });
  const servicePlans = Object.entries(services)
    .map(([serviceName, value]) => {
      const service = readObject(value);
      return service
        ? buildServicePlan({
            serviceName,
            service,
            topLevelSecrets
          })
        : null;
    })
    .filter((service): service is ComposeBuildPlanService => service !== null)
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName));

  const totalServices = graph.graphServices.length;
  const strategy =
    servicePlans.length === 0
      ? "pull-only"
      : servicePlans.length === totalServices
        ? "build-only"
        : "mixed";

  return {
    status: "materialized",
    version: 1,
    stackName: graph.stackName,
    strategy,
    services: servicePlans,
    graphServices: graph.graphServices,
    networks: graph.networks,
    volumes: graph.volumes,
    secrets: graph.secrets,
    configs: graph.configs,
    warnings: [...new Set(normalizedWarnings)]
  };
}
