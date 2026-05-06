import {
  readServiceDomainConfigFromConfig,
  type ServicePortMapping,
  type ServicePortProtocol,
  writeServiceDomainConfigToConfig
} from "../../service-domain-config";
import { newId as id } from "./json-helpers";
import {
  loadServiceContext,
  writeServiceConfig,
  type DomainMutationInputBase
} from "./service-domains";

export interface ServicePortMappingInput {
  id?: string;
  hostPort: number;
  containerPort: number;
  protocol: ServicePortProtocol;
}

function invalidPort(value: number) {
  return !Number.isInteger(value) || value < 1 || value > 65535;
}

export async function updateServicePortMappings(
  input: DomainMutationInputBase & {
    portMappings: ServicePortMappingInput[];
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  const seenKeys = new Set<string>();
  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const existingPortMappings = new Map(
    (existing?.portMappings ?? []).map((mapping) => [mapping.id, mapping])
  );

  const portMappings: ServicePortMapping[] = [];
  for (const mapping of input.portMappings) {
    if (invalidPort(mapping.hostPort) || invalidPort(mapping.containerPort)) {
      return {
        status: "invalid" as const,
        message: "Port mappings must use integer ports between 1 and 65535."
      };
    }

    const protocol = mapping.protocol === "udp" ? "udp" : "tcp";
    const dedupeKey = `${mapping.hostPort}:${protocol}`;
    if (seenKeys.has(dedupeKey)) {
      return {
        status: "conflict" as const,
        message: `Duplicate host port ${mapping.hostPort}/${protocol} is not allowed.`
      };
    }
    seenKeys.add(dedupeKey);

    const existingMapping =
      typeof mapping.id === "string" ? existingPortMappings.get(mapping.id) : undefined;
    portMappings.push({
      id: existingMapping?.id ?? id(),
      hostPort: mapping.hostPort,
      containerPort: mapping.containerPort,
      protocol,
      createdAt: existingMapping?.createdAt ?? new Date().toISOString()
    });
  }

  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      portMappings
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.port-mappings.update",
    inputSummary: `Updated ${portMappings.length} port mappings for "${context.service.name}"`,
    metadata: {
      portMappings: portMappings.map((mapping) => ({
        hostPort: mapping.hostPort,
        containerPort: mapping.containerPort,
        protocol: mapping.protocol
      }))
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}
