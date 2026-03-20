import { eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { services } from "../schema/services";
import {
  type ServiceRuntimeConfigPatch,
  writeServiceRuntimeConfigToConfig
} from "../../service-runtime-config";
import { normalizeServiceRecord } from "./services";

export interface UpdateServiceRuntimeConfigInput extends ServiceRuntimeConfigPatch {
  serviceId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

function supportsRuntimeConfig(service: typeof services.$inferSelect): boolean {
  return service.sourceType === "compose" && typeof service.composeServiceName === "string";
}

function unsupportedRuntimeConfigMessage(service: typeof services.$inferSelect): string {
  if (service.sourceType !== "compose") {
    return "Structured runtime overrides are only supported for compose services.";
  }

  return "Structured runtime overrides require a concrete compose service name.";
}

export async function updateServiceRuntimeConfig(input: UpdateServiceRuntimeConfigInput) {
  const [existing] = await db
    .select()
    .from(services)
    .where(eq(services.id, input.serviceId))
    .limit(1);

  if (!existing) {
    return { status: "not_found" as const };
  }

  if (!supportsRuntimeConfig(existing)) {
    return {
      status: "unsupported" as const,
      message: unsupportedRuntimeConfigMessage(existing)
    };
  }

  const [service] = await db
    .update(services)
    .set({
      config: writeServiceRuntimeConfigToConfig({
        config: existing.config,
        patch: {
          volumes: input.volumes,
          networks: input.networks,
          restartPolicy: input.restartPolicy,
          healthCheck: input.healthCheck,
          resources: input.resources
        }
      }),
      updatedAt: new Date()
    })
    .where(eq(services.id, input.serviceId))
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${input.serviceId}`,
    action: "service.runtime-config.update",
    inputSummary: `Updated DaoFlow-managed runtime overrides for "${service.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: {
      resourceType: "service",
      resourceId: input.serviceId,
      composeServiceName: service.composeServiceName
    }
  });

  return { status: "ok" as const, service: normalizeServiceRecord(service) };
}
