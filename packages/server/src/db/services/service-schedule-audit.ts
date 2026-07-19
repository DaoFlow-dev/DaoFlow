import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import type { serviceSchedules } from "../schema/service-schedules";

export type ServiceScheduleActor = {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  actorType?: "user" | "agent" | "system" | "token";
};

export type ServiceScheduleAuditInput = {
  schedule: typeof serviceSchedules.$inferSelect;
  actor: ServiceScheduleActor;
  action: string;
  summary: string;
  permissionScope?: string;
  outcome?: "success" | "failure" | "denied";
  runId?: string;
};

export function buildServiceScheduleAuditEntry(
  input: ServiceScheduleAuditInput
): typeof auditEntries.$inferInsert {
  return {
    actorType: input.actor.actorType ?? "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: `service_schedule/${input.schedule.id}`,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: input.permissionScope ?? "service:update",
    outcome: input.outcome ?? "success",
    metadata: {
      resourceType: "service_schedule",
      resourceId: input.schedule.id,
      serviceId: input.schedule.serviceId,
      projectId: input.schedule.projectId,
      environmentId: input.schedule.environmentId,
      scheduleName: input.schedule.name,
      runId: input.runId ?? null,
      detail: input.summary
    }
  };
}

export async function recordServiceScheduleAudit(input: ServiceScheduleAuditInput) {
  await db.insert(auditEntries).values(buildServiceScheduleAuditEntry(input));
}
