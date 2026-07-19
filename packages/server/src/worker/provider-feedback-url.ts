import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { services } from "../db/schema/services";
import { tunnelRoutes, tunnels } from "../db/schema/tunnels";
import type { ProviderFeedbackContext } from "../db/services/provider-feedback-types";
import {
  normalizeServiceDomainHostname,
  readServiceDomainConfigFromConfig
} from "../service-domain-config";

function configuredAppBaseUrl() {
  const raw = process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL;
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function buildDaoFlowDeploymentUrl(deploymentId: string) {
  const appBaseUrl = configuredAppBaseUrl();
  return appBaseUrl
    ? `${appBaseUrl}/deployments?deployment=${encodeURIComponent(deploymentId)}`
    : null;
}

async function configuredPrimaryDomain(context: ProviderFeedbackContext) {
  const serviceName = context.deployment.serviceName?.trim();
  if (!serviceName) return null;

  const serviceRows = await db
    .select({ config: services.config })
    .from(services)
    .where(
      and(
        eq(services.projectId, context.project.id),
        eq(services.environmentId, context.deployment.environmentId),
        eq(services.name, serviceName)
      )
    )
    .limit(2);
  if (serviceRows.length !== 1) return null;

  const domains = readServiceDomainConfigFromConfig(serviceRows[0]?.config)?.domains ?? [];
  return domains.find((domain) => domain.isPrimary)?.hostname ?? null;
}

/**
 * Returns a public preview URL only after the successful deployment's exact
 * service route is currently active for the same team.
 */
export async function resolveVerifiedPreviewUrl(input: {
  teamId: string;
  context: ProviderFeedbackContext;
  includePreviewUrl: boolean;
}) {
  if (!input.includePreviewUrl || input.context.preview?.action === "destroy") {
    return null;
  }

  const candidate =
    input.context.preview?.primaryDomain ?? (await configuredPrimaryDomain(input.context));
  const hostname = candidate ? normalizeServiceDomainHostname(candidate) : null;
  const serviceName = input.context.deployment.serviceName?.trim();
  if (!hostname || !serviceName) return null;

  const [route] = await db
    .select({ id: tunnelRoutes.id })
    .from(tunnelRoutes)
    .innerJoin(tunnels, eq(tunnels.id, tunnelRoutes.tunnelId))
    .where(
      and(
        eq(tunnels.teamId, input.teamId),
        eq(tunnelRoutes.hostname, hostname),
        eq(tunnelRoutes.service, serviceName),
        eq(tunnelRoutes.status, "active")
      )
    )
    .limit(1);

  return route ? `https://${hostname}` : null;
}
