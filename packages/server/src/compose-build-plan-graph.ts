import type {
  ComposeBuildPlanConfig,
  ComposeBuildPlanConfigDefinition,
  ComposeBuildPlanDependency,
  ComposeBuildPlanGraphService,
  ComposeBuildPlanHealthcheck,
  ComposeBuildPlanNetwork,
  ComposeBuildPlanSecret,
  ComposeBuildPlanSecretDefinition,
  ComposeBuildPlanVolume
} from "./compose-build-plan-types";
import {
  isExternalReference,
  readObject,
  readServices,
  resolveTopLevelSecretDefinition
} from "./compose-build-plan-shared";

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : [])))
  )
    .filter((entry) => entry.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function readNamedRecord(value: unknown): Array<[string, Record<string, unknown>]> {
  const record = readObject(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .flatMap(([name, entryValue]) => {
      const entryRecord = readObject(entryValue);
      return entryRecord ? ([[name, entryRecord]] as Array<[string, Record<string, unknown>]>) : [];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function classifyConfigDefinition(
  sourceName: string,
  topLevelConfigs: Record<string, unknown>
): Omit<ComposeBuildPlanConfigDefinition, "name" | "external"> {
  const config = readObject(topLevelConfigs[sourceName]);
  if (!config) {
    return {
      provider: "unknown",
      reference: null
    };
  }

  if (typeof config.file === "string") {
    return {
      provider: "file",
      reference: config.file
    };
  }

  if (typeof config.environment === "string") {
    return {
      provider: "environment",
      reference: config.environment
    };
  }

  if (typeof config.content === "string") {
    return {
      provider: "content",
      reference: "[inline]"
    };
  }

  if (isExternalReference(config.external)) {
    return {
      provider: "external",
      reference: typeof config.name === "string" ? config.name : sourceName
    };
  }

  return {
    provider: "unknown",
    reference: null
  };
}

function buildDependencies(value: unknown): ComposeBuildPlanDependency[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) =>
        typeof entry === "string"
          ? [
              {
                serviceName: entry.trim(),
                condition: "service_started",
                required: true,
                restart: false
              } satisfies ComposeBuildPlanDependency
            ]
          : []
      )
      .filter((entry) => entry.serviceName.length > 0)
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  }

  return readNamedRecord(value).map(([serviceName, record]) => ({
    serviceName,
    condition:
      record.condition === "service_healthy" ||
      record.condition === "service_completed_successfully"
        ? record.condition
        : "service_started",
    required: record.required !== false,
    restart: record.restart === true
  }));
}

function buildHealthcheck(value: unknown): ComposeBuildPlanHealthcheck {
  const record = readObject(value);
  if (!record) {
    return {
      present: false,
      disabled: false,
      testType: "none",
      interval: null,
      timeout: null,
      startPeriod: null,
      startInterval: null,
      retries: null
    };
  }

  const test = record.test;
  const disabled =
    readBoolean(record.disable) === true ||
    test === "NONE" ||
    (Array.isArray(test) &&
      test.length > 0 &&
      typeof test[0] === "string" &&
      test[0].trim().toUpperCase() === "NONE");

  return {
    present: true,
    disabled,
    testType: disabled
      ? "none"
      : typeof test === "string" || Array.isArray(test)
        ? "command"
        : "unknown",
    interval: readString(record.interval),
    timeout: readString(record.timeout),
    startPeriod: readString(record.start_period),
    startInterval: readString(record.start_interval),
    retries: typeof record.retries === "number" ? record.retries : null
  };
}

function buildNetworks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return readStringArray(value);
  }

  return readNamedRecord(value).map(([name]) => name);
}

function classifyVolumeSource(source: string): "named" | "bind" | "anonymous" {
  const trimmed = source.trim();
  if (!trimmed) {
    return "anonymous";
  }

  if (
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return "bind";
  }

  return "named";
}

function buildNamedVolumes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.flatMap((entry) => {
        if (typeof entry === "string") {
          const segments = entry.split(":");
          const source = segments.length >= 2 ? (segments[0] ?? "") : "";
          return classifyVolumeSource(source) === "named" && source.trim().length > 0
            ? [source.trim()]
            : [];
        }

        const record = readObject(entry);
        if (!record) {
          return [];
        }

        const type = readString(record.type);
        const source = readString(record.source);
        if (type === "bind" || !source) {
          return [];
        }

        if (type === "volume" || classifyVolumeSource(source) === "named") {
          return [source];
        }

        return [];
      })
    )
  ).sort((a, b) => a.localeCompare(b));
}

function buildRuntimeSecrets(
  value: unknown,
  topLevelSecrets: Record<string, unknown>
): ComposeBuildPlanSecret[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        const resolved = resolveTopLevelSecretDefinition(entry, topLevelSecrets);
        return [
          {
            sourceName: entry,
            provider: resolved.provider,
            reference: resolved.reference,
            target: null
          } satisfies ComposeBuildPlanSecret
        ];
      }

      const record = readObject(entry);
      const sourceName =
        typeof record?.source === "string"
          ? record.source
          : typeof record?.secret === "string"
            ? record.secret
            : null;
      if (!sourceName) {
        return [];
      }

      const resolved = resolveTopLevelSecretDefinition(sourceName, topLevelSecrets);
      return [
        {
          sourceName,
          provider: resolved.provider,
          reference: resolved.reference,
          target: readString(record?.target)
        } satisfies ComposeBuildPlanSecret
      ];
    })
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function buildConfigs(
  value: unknown,
  topLevelConfigs: Record<string, unknown>
): ComposeBuildPlanConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        const resolved = classifyConfigDefinition(entry, topLevelConfigs);
        return [
          {
            sourceName: entry,
            provider: resolved.provider,
            reference: resolved.reference,
            target: null
          } satisfies ComposeBuildPlanConfig
        ];
      }

      const record = readObject(entry);
      const sourceName =
        typeof record?.source === "string"
          ? record.source
          : typeof record?.config === "string"
            ? record.config
            : null;
      if (!sourceName) {
        return [];
      }

      const resolved = classifyConfigDefinition(sourceName, topLevelConfigs);
      return [
        {
          sourceName,
          provider: resolved.provider,
          reference: resolved.reference,
          target: readString(record?.target)
        } satisfies ComposeBuildPlanConfig
      ];
    })
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

export function collectComposeGraphWarnings(
  doc: Record<string, unknown>,
  warnings: string[]
): void {
  for (const field of ["include", "fragments", "merge"] as const) {
    if (doc[field] !== undefined) {
      warnings.push(
        `Compose field "${field}" is not normalized into DaoFlow's compose graph yet; deployment execution will still rely on Docker Compose for final resolution.`
      );
    }
  }

  for (const [serviceName, value] of Object.entries(readServices(doc))) {
    const service = readObject(value);
    if (!service) {
      continue;
    }

    for (const field of ["extends", "develop"] as const) {
      if (service[field] !== undefined) {
        warnings.push(
          `Compose service "${serviceName}" uses "${field}", which DaoFlow records only as a warning today and does not normalize into the execution graph.`
        );
      }
    }
  }
}

export function buildComposeGraph(input: { doc: Record<string, unknown>; warnings: string[] }): {
  stackName: string | null;
  graphServices: ComposeBuildPlanGraphService[];
  networks: ComposeBuildPlanNetwork[];
  volumes: ComposeBuildPlanVolume[];
  secrets: ComposeBuildPlanSecretDefinition[];
  configs: ComposeBuildPlanConfigDefinition[];
} {
  const topLevelSecrets = readObject(input.doc.secrets) ?? {};
  const topLevelConfigs = readObject(input.doc.configs) ?? {};
  const services = readServices(input.doc);

  collectComposeGraphWarnings(input.doc, input.warnings);

  return {
    stackName: readString(input.doc.name),
    graphServices: Object.entries(services)
      .flatMap(([serviceName, value]) => {
        const service = readObject(value);
        return service
          ? [
              {
                serviceName,
                image: readString(service.image),
                hasBuild: service.build !== undefined,
                dependsOn: buildDependencies(service.depends_on),
                healthcheck: buildHealthcheck(service.healthcheck),
                networks: buildNetworks(service.networks),
                namedVolumes: buildNamedVolumes(service.volumes),
                runtimeSecrets: buildRuntimeSecrets(service.secrets, topLevelSecrets),
                configs: buildConfigs(service.configs, topLevelConfigs),
                profiles: readStringArray(service.profiles)
              } satisfies ComposeBuildPlanGraphService
            ]
          : [];
      })
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
    networks: readNamedRecord(input.doc.networks).map(([name, record]) => ({
      name,
      external: isExternalReference(record.external),
      driver: readString(record.driver)
    })),
    volumes: readNamedRecord(input.doc.volumes).map(([name, record]) => ({
      name,
      external: isExternalReference(record.external),
      driver: readString(record.driver)
    })),
    secrets: Object.keys(topLevelSecrets)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const resolved = resolveTopLevelSecretDefinition(name, topLevelSecrets);
        return {
          name,
          provider: resolved.provider,
          reference: resolved.reference,
          external: isExternalReference(readObject(topLevelSecrets[name])?.external)
        } satisfies ComposeBuildPlanSecretDefinition;
      }),
    configs: Object.keys(topLevelConfigs)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const resolved = classifyConfigDefinition(name, topLevelConfigs);
        return {
          name,
          provider: resolved.provider,
          reference: resolved.reference,
          external: isExternalReference(readObject(topLevelConfigs[name])?.external)
        } satisfies ComposeBuildPlanConfigDefinition;
      })
  };
}
