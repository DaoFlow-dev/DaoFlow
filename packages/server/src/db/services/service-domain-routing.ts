import {
  readServiceDomainConfigFromConfig,
  writeServiceDomainConfigToConfig
} from "../../service-domain-config";
import {
  loadServiceContext,
  writeServiceConfig,
  type DomainMutationInputBase
} from "./service-domains";

function invalidPort(value: number) {
  return !Number.isInteger(value) || value < 1 || value > 65535;
}

export async function updateServiceDomainRouting(
  input: DomainMutationInputBase & {
    domainId: string;
    routingMode: "observed" | "managed-traefik";
    targetPort?: number | null;
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  if (
    input.targetPort !== undefined &&
    input.targetPort !== null &&
    invalidPort(input.targetPort)
  ) {
    return {
      status: "invalid" as const,
      message: "Managed Traefik target port must be between 1 and 65535."
    };
  }

  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const currentDomains = existing?.domains ?? [];
  const changedDomain = currentDomains.find((domain) => domain.id === input.domainId);
  if (!changedDomain) {
    return {
      status: "domain_not_found" as const
    };
  }

  const domains = currentDomains.map((domain) =>
    domain.id === input.domainId
      ? {
          ...domain,
          routingMode: input.routingMode,
          targetPort: input.routingMode === "managed-traefik" ? (input.targetPort ?? null) : null
        }
      : domain
  );
  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      domains
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.domain.routing.update",
    inputSummary: `Updated routing for "${changedDomain.hostname}" on "${context.service.name}"`,
    metadata: {
      hostname: changedDomain.hostname,
      domainId: changedDomain.id,
      routingMode: input.routingMode,
      targetPort: input.targetPort ?? null
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}
