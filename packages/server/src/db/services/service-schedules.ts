import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { environments, projects } from "../schema/projects";
import { serviceScheduleRuns, serviceSchedules } from "../schema/service-schedules";
import { services } from "../schema/services";
import {
  computeNextRunAt,
  validateCronExpression,
  validateTimezone
} from "./service-schedule-cron";
import { newId } from "./json-helpers";
import {
  serializeServiceSchedule,
  serializeServiceScheduleRun
} from "./service-schedule-serialization";
import {
  buildServiceScheduleAuditEntry,
  recordServiceScheduleAudit,
  type ServiceScheduleActor
} from "./service-schedule-audit";

export { createDueServiceScheduleRuns } from "./service-schedule-occurrences";

export async function readServiceScheduleForTeam(scheduleId: string, teamId: string) {
  const [row] = await db
    .select({
      schedule: serviceSchedules,
      service: services,
      project: projects,
      environment: environments
    })
    .from(serviceSchedules)
    .innerJoin(services, eq(services.id, serviceSchedules.serviceId))
    .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
    .innerJoin(environments, eq(environments.id, serviceSchedules.environmentId))
    .where(and(eq(serviceSchedules.id, scheduleId), eq(projects.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

function validateScheduleInput(input: {
  command: string;
  cronExpression: string;
  timezone: string;
  retentionCount: number;
}) {
  const cronError = validateCronExpression(input.cronExpression);
  if (cronError) return cronError;
  if (!validateTimezone(input.timezone)) return "Timezone is invalid.";
  if (input.command.trim().length === 0) return "Command is required.";
  if (input.retentionCount < 1 || input.retentionCount > 100) {
    return "Retention count must be between 1 and 100.";
  }
  return null;
}

export async function listServiceSchedules(input: {
  teamId: string;
  serviceId?: string;
  limit?: number;
}) {
  const filters = [eq(projects.teamId, input.teamId), ne(serviceSchedules.status, "deleted")];
  if (input.serviceId) filters.push(eq(serviceSchedules.serviceId, input.serviceId));

  const rows = await db
    .select({
      schedule: serviceSchedules,
      serviceName: services.name,
      projectName: projects.name,
      environmentName: environments.name
    })
    .from(serviceSchedules)
    .innerJoin(services, eq(services.id, serviceSchedules.serviceId))
    .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
    .innerJoin(environments, eq(environments.id, serviceSchedules.environmentId))
    .where(and(...filters))
    .orderBy(desc(serviceSchedules.createdAt))
    .limit(input.limit ?? 50);

  return rows.map((row) => ({
    ...serializeServiceSchedule(row.schedule),
    serviceName: row.serviceName,
    projectName: row.projectName,
    environmentName: row.environmentName
  }));
}

export async function listServiceScheduleRuns(input: {
  teamId: string;
  scheduleId: string;
  limit?: number;
}) {
  const schedule = await readServiceScheduleForTeam(input.scheduleId, input.teamId);
  if (!schedule) return null;
  const runs = await db
    .select()
    .from(serviceScheduleRuns)
    .where(eq(serviceScheduleRuns.scheduleId, input.scheduleId))
    .orderBy(desc(serviceScheduleRuns.createdAt))
    .limit(input.limit ?? 50);
  return {
    schedule: serializeServiceSchedule(schedule.schedule),
    runs: runs.map(serializeServiceScheduleRun)
  };
}

export async function createServiceSchedule(input: {
  serviceId: string;
  teamId: string;
  name: string;
  command: string;
  cronExpression: string;
  timezone?: string;
  retentionCount?: number;
  notifyOnFailure?: boolean;
  actor: ServiceScheduleActor;
}) {
  const serviceRows = await db
    .select({ service: services, project: projects, environment: environments })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .innerJoin(environments, eq(environments.id, services.environmentId))
    .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
    .limit(1);
  const row = serviceRows[0];
  if (!row) return { status: "not_found" as const };

  const timezone = input.timezone ?? "UTC";
  const retentionCount = input.retentionCount ?? 20;
  const validationError = validateScheduleInput({
    command: input.command,
    cronExpression: input.cronExpression,
    timezone,
    retentionCount
  });
  if (validationError) return { status: "invalid" as const, message: validationError };

  const now = new Date();
  const [schedule] = await db
    .insert(serviceSchedules)
    .values({
      id: newId(),
      projectId: row.project.id,
      environmentId: row.environment.id,
      serviceId: row.service.id,
      name: input.name.trim(),
      command: input.command.trim(),
      cronExpression: input.cronExpression.trim(),
      timezone,
      retentionCount,
      notifyOnFailure: input.notifyOnFailure ?? true,
      nextRunAt: computeNextRunAt(input.cronExpression, undefined, timezone),
      createdByUserId: input.actor.requestedByUserId,
      updatedByUserId: input.actor.requestedByUserId,
      updatedAt: now
    })
    .returning();
  await recordServiceScheduleAudit({
    schedule,
    actor: input.actor,
    action: "service_schedule.create",
    summary: `Created schedule ${schedule.name} for service ${row.service.name}.`
  });
  return { status: "ok" as const, schedule: serializeServiceSchedule(schedule) };
}

export async function setServiceScheduleState(input: {
  scheduleId: string;
  teamId: string;
  state: "pause" | "resume";
  actor: ServiceScheduleActor;
}) {
  const row = await readServiceScheduleForTeam(input.scheduleId, input.teamId);
  if (!row || row.schedule.status === "deleted") return { status: "not_found" as const };
  const nextStatus = input.state === "pause" ? "paused" : "active";
  const [schedule] = await db
    .update(serviceSchedules)
    .set({
      status: nextStatus,
      enabled: nextStatus === "active",
      nextRunAt:
        nextStatus === "active"
          ? computeNextRunAt(row.schedule.cronExpression, undefined, row.schedule.timezone)
          : null,
      updatedByUserId: input.actor.requestedByUserId,
      updatedAt: new Date()
    })
    .where(eq(serviceSchedules.id, input.scheduleId))
    .returning();
  await recordServiceScheduleAudit({
    schedule,
    actor: input.actor,
    action: `service_schedule.${input.state}`,
    summary: `${input.state === "pause" ? "Paused" : "Resumed"} schedule ${schedule.name}.`
  });
  return { status: "ok" as const, schedule: serializeServiceSchedule(schedule) };
}

export async function deleteServiceSchedule(input: {
  scheduleId: string;
  teamId: string;
  actor: ServiceScheduleActor;
}) {
  const row = await readServiceScheduleForTeam(input.scheduleId, input.teamId);
  if (!row || row.schedule.status === "deleted") return { status: "not_found" as const };
  const [schedule] = await db
    .update(serviceSchedules)
    .set({ status: "deleted", enabled: false, nextRunAt: null, updatedAt: new Date() })
    .where(eq(serviceSchedules.id, input.scheduleId))
    .returning();
  await recordServiceScheduleAudit({
    schedule,
    actor: input.actor,
    action: "service_schedule.delete",
    summary: `Deleted schedule ${schedule.name}.`
  });
  return { status: "ok" as const, scheduleId: input.scheduleId };
}

export async function createServiceScheduleRun(input: {
  scheduleId: string;
  teamId: string;
  triggerKind: "manual";
  actor: ServiceScheduleActor;
}) {
  const row = await readServiceScheduleForTeam(input.scheduleId, input.teamId);
  if (!row || row.schedule.status === "deleted") return { status: "not_found" as const };
  const run = await db.transaction(async (tx) => {
    const [createdRun] = await tx
      .insert(serviceScheduleRuns)
      .values({
        id: newId(),
        scheduleId: row.schedule.id,
        serviceId: row.schedule.serviceId,
        triggerKind: input.triggerKind,
        status: "queued",
        command: row.schedule.command,
        logs: "Queued for service schedule runner handoff.",
        requestedByUserId: input.actor.requestedByUserId,
        requestedByEmail: input.actor.requestedByEmail,
        requestedByRole: input.actor.requestedByRole
      })
      .returning();
    if (!createdRun) throw new Error("Unable to create manual service schedule run.");

    await tx.insert(auditEntries).values(
      buildServiceScheduleAuditEntry({
        schedule: row.schedule,
        actor: input.actor,
        action: "service_schedule.run_manual",
        summary: `Queued manual run for schedule ${row.schedule.name}.`,
        runId: createdRun.id
      })
    );
    return createdRun;
  });
  return { status: "ok" as const, run: serializeServiceScheduleRun(run), schedule: row.schedule };
}
