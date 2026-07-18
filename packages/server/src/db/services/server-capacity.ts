import { and, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { servers } from "../schema/servers";
import { lockTargetServerForDeploymentCapacity } from "./deployment-capacity";

export interface ConfigureServerCapacityInput {
  serverId: string;
  teamId: string;
  maxConcurrentBuilds: number;
  maxQueuedDeployments: number;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export class ServerCapacityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerCapacityValidationError";
  }
}

function validateCapacityValue(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ServerCapacityValidationError(
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
}

export async function configureServerCapacity(input: ConfigureServerCapacityInput) {
  validateCapacityValue(input.maxConcurrentBuilds, "Maximum concurrent builds", 1, 20);
  validateCapacityValue(input.maxQueuedDeployments, "Maximum queued deployments", 1, 500);

  return db.transaction(async (tx) => {
    const server = await lockTargetServerForDeploymentCapacity(tx, input.serverId);
    if (!server || server.teamId !== input.teamId) {
      return { status: "not_found" as const };
    }

    const [updatedServer] = await tx
      .update(servers)
      .set({
        maxConcurrentBuilds: input.maxConcurrentBuilds,
        maxQueuedDeployments: input.maxQueuedDeployments,
        updatedAt: new Date()
      })
      .where(and(eq(servers.id, input.serverId), eq(servers.teamId, input.teamId)))
      .returning();

    await tx.insert(auditEntries).values({
      actorType: "user",
      actorId: input.requestedByUserId,
      actorEmail: input.requestedByEmail,
      actorRole: input.requestedByRole,
      targetResource: `server/${input.serverId}`,
      action: "server.capacity.configure",
      inputSummary: `Configured deployment capacity for server ${server.name}.`,
      permissionScope: "server:write",
      outcome: "success",
      metadata: {
        resourceType: "server",
        resourceId: input.serverId,
        resourceLabel: server.name,
        previous: {
          maxConcurrentBuilds: server.maxConcurrentBuilds,
          maxQueuedDeployments: server.maxQueuedDeployments
        },
        next: {
          maxConcurrentBuilds: input.maxConcurrentBuilds,
          maxQueuedDeployments: input.maxQueuedDeployments
        }
      }
    });

    return { status: "ok" as const, server: updatedServer };
  });
}
