import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { resolveExecutionTarget, type ExecutionTarget } from "../../worker/execution-target";
import { buildDockerContainerName } from "../../docker-identifiers";
import { asRecord, readString } from "./json-helpers";

export type ResolvedServiceRuntime =
  | {
      kind: "compose";
      service: typeof services.$inferSelect;
      deployment: typeof deployments.$inferSelect;
      server: typeof servers.$inferSelect;
      target: ExecutionTarget;
      projectName: string;
      composeServiceName: string;
    }
  | {
      kind: "container";
      service: typeof services.$inferSelect;
      deployment: typeof deployments.$inferSelect;
      server: typeof servers.$inferSelect;
      target: ExecutionTarget;
      containerName: string;
    };

export type ResolveServiceRuntimeResult =
  | {
      status: "ok";
      runtime: ResolvedServiceRuntime;
    }
  | {
      status: "not_found" | "no_runtime" | "no_server";
      message: string;
    };

function normalizeServiceName(value: string): string {
  return value.trim();
}

/**
 * Extract the compose service name from the build plan stored in the
 * deployment config snapshot.  When a compose project has a single
 * graph service (the common case for DaoFlow services), its
 * `serviceName` matches the Docker label
 * `com.docker.compose.service`.
 */
function deriveComposeServiceNameFromBuildPlan(snapshot: Record<string, unknown>): string {
  const buildPlan = snapshot.composeBuildPlan;
  if (!buildPlan || typeof buildPlan !== "object") return "";

  const graphServices = (buildPlan as Record<string, unknown>).graphServices;
  if (!Array.isArray(graphServices) || graphServices.length === 0) return "";

  const first = graphServices[0] as Record<string, unknown> | undefined;
  const name = first?.serviceName;
  return typeof name === "string" ? name.trim() : "";
}

function deriveProjectName(deployment: typeof deployments.$inferSelect): string {
  const snapshot = asRecord(deployment.configSnapshot);
  const explicitProjectName = readString(snapshot, "projectName");
  if (explicitProjectName) {
    return explicitProjectName;
  }

  return deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function deriveContainerName(
  deployment: typeof deployments.$inferSelect,
  service: typeof services.$inferSelect
): string {
  if (deployment.containerId?.trim()) {
    return deployment.containerId.trim();
  }

  return buildDockerContainerName(deriveProjectName(deployment), service.name);
}

export async function resolveServiceRuntime(
  serviceId: string
): Promise<ResolveServiceRuntimeResult> {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);

  if (!service) {
    return {
      status: "not_found",
      message: "Service not found."
    };
  }

  const [deployment] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, service.projectId),
        eq(deployments.environmentId, service.environmentId),
        eq(deployments.serviceName, service.name),
        eq(deployments.sourceType, service.sourceType),
        eq(deployments.conclusion, "succeeded")
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  if (!deployment) {
    return {
      status: "no_runtime",
      message: "No successful deployment exists for this service yet."
    };
  }

  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, deployment.targetServerId))
    .limit(1);

  if (!server) {
    return {
      status: "no_server",
      message: `Target server ${deployment.targetServerId} could not be resolved.`
    };
  }

  const target = resolveExecutionTarget(server, `obs_${deployment.id}`);

  if (service.sourceType === "compose") {
    const snapshot = asRecord(deployment.configSnapshot);
    const composeServiceName =
      readString(snapshot, "composeServiceName") ||
      normalizeServiceName(service.composeServiceName ?? "") ||
      deriveComposeServiceNameFromBuildPlan(snapshot) ||
      normalizeServiceName(service.name);

    return {
      status: "ok",
      runtime: {
        kind: "compose",
        service,
        deployment,
        server,
        target,
        projectName: deriveProjectName(deployment),
        composeServiceName
      }
    };
  }

  return {
    status: "ok",
    runtime: {
      kind: "container",
      service,
      deployment,
      server,
      target,
      containerName: deriveContainerName(deployment, service)
    }
  };
}
