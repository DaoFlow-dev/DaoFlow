import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";

export interface LogDrainActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export async function recordDrainAudit(input: {
  actor: LogDrainActor;
  drainId: string;
  drainName: string;
  action: string;
  summary: string;
  outcome?: "success" | "failure";
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: `log_drain/${input.drainId}`,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: "server:write",
    outcome: input.outcome ?? "success",
    metadata: {
      resourceType: "log_drain",
      resourceId: input.drainId,
      resourceLabel: input.drainName,
      detail: input.summary
    }
  });
}

export async function recordDrainEvent(input: {
  drainId: string;
  drainName: string;
  kind: string;
  summary: string;
  severity?: "info" | "warning" | "error";
}) {
  await db.insert(events).values({
    kind: input.kind,
    resourceType: "log_drain",
    resourceId: input.drainId,
    summary: input.summary,
    severity: input.severity ?? "info",
    metadata: { drainName: input.drainName }
  });
}
