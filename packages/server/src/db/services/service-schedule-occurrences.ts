import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects } from "../schema/projects";
import {
  serviceScheduleMonitorLeases,
  serviceScheduleRuns,
  serviceSchedules
} from "../schema/service-schedules";
import { computeNextRunAt } from "./service-schedule-cron";
import { newId } from "./json-helpers";
import { serializeServiceScheduleRun } from "./service-schedule-serialization";
import {
  buildServiceScheduleAuditEntry,
  type ServiceScheduleActor
} from "./service-schedule-audit";
import type { ServiceScheduleMonitorLease } from "./service-schedule-lease";

type MonitorLeaseReference = Pick<
  ServiceScheduleMonitorLease,
  "key" | "holderInstanceId" | "generation"
>;

export async function recoverStaleServiceScheduleRuns(input: {
  actor: ServiceScheduleActor;
  lease: MonitorLeaseReference;
  limit?: number;
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(serviceScheduleMonitorLeases)
      .where(eq(serviceScheduleMonitorLeases.key, input.lease.key))
      .limit(1)
      .for("update");
    const clock = await tx.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);
    const nowValue = clock.rows[0]?.now;
    const databaseNow = nowValue instanceof Date ? nowValue : new Date(String(nowValue));
    if (
      !lease ||
      lease.holderInstanceId !== input.lease.holderInstanceId ||
      lease.generation !== input.lease.generation ||
      lease.expiresAt.getTime() <= databaseNow.getTime()
    ) {
      return 0;
    }

    const staleRuns = await tx
      .select({ run: serviceScheduleRuns, schedule: serviceSchedules })
      .from(serviceScheduleRuns)
      .innerJoin(serviceSchedules, eq(serviceSchedules.id, serviceScheduleRuns.scheduleId))
      .where(
        and(
          eq(serviceScheduleRuns.triggerKind, "scheduled"),
          eq(serviceScheduleRuns.status, "running"),
          or(
            isNull(serviceScheduleRuns.leaseGeneration),
            isNull(serviceScheduleRuns.leaseHolderInstanceId),
            lt(serviceScheduleRuns.leaseGeneration, input.lease.generation)
          )
        )
      )
      .orderBy(asc(serviceScheduleRuns.createdAt))
      .limit(input.limit ?? 20)
      .for("update", { skipLocked: true });

    let recovered = 0;
    for (const row of staleRuns) {
      const [run] = await tx
        .update(serviceScheduleRuns)
        .set({
          status: "failed",
          logs: [
            "Service schedule run was recovered after monitor lease takeover.",
            "Execution outcome is unknown because the prior leader lost its lease.",
            "Command output and diagnostics are [redacted]."
          ].join("\n"),
          result: {
            outcome: "failed",
            reason: "monitor_lease_lost",
            recovery: {
              previousLeaseGeneration: row.run.leaseGeneration,
              currentLeaseGeneration: input.lease.generation,
              diagnostic: "[redacted]"
            }
          },
          error: "Monitor lease was taken over; execution diagnostics are [redacted].",
          finishedAt: databaseNow,
          updatedAt: databaseNow
        })
        .where(
          and(
            eq(serviceScheduleRuns.id, row.run.id),
            eq(serviceScheduleRuns.status, "running"),
            or(
              isNull(serviceScheduleRuns.leaseGeneration),
              isNull(serviceScheduleRuns.leaseHolderInstanceId),
              lt(serviceScheduleRuns.leaseGeneration, input.lease.generation)
            )
          )
        )
        .returning();
      if (!run) continue;

      await tx
        .update(serviceSchedules)
        .set({ lastRunAt: databaseNow, updatedAt: databaseNow })
        .where(eq(serviceSchedules.id, row.schedule.id));
      await tx.insert(auditEntries).values(
        buildServiceScheduleAuditEntry({
          schedule: row.schedule,
          actor: input.actor,
          action: "service_schedule.run_recovered",
          summary: [
            `Recovered scheduled run ${run.id} after monitor lease takeover.`,
            "Command output and diagnostics are [redacted]."
          ].join(" "),
          outcome: "failure",
          runId: run.id
        })
      );
      recovered += 1;
    }

    return recovered;
  });
}

export async function createDueServiceScheduleRuns(input: {
  teamId?: string;
  now?: Date;
  actor: ServiceScheduleActor;
  lease: MonitorLeaseReference;
  limit?: number;
}) {
  const dueBefore = input.now ?? sql<Date>`clock_timestamp()`;
  const filters = [
    eq(serviceSchedules.status, "active"),
    eq(serviceSchedules.enabled, true),
    lte(serviceSchedules.nextRunAt, dueBefore)
  ];
  if (input.teamId) filters.push(eq(projects.teamId, input.teamId));

  const dueRows = await db
    .select({ schedule: serviceSchedules })
    .from(serviceSchedules)
    .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
    .where(and(...filters))
    .orderBy(asc(serviceSchedules.nextRunAt))
    .limit(input.limit ?? 20);

  const created = [];
  for (const row of dueRows) {
    const result = await claimDueServiceScheduleOccurrence({
      scheduleId: row.schedule.id,
      scheduledFor: row.schedule.nextRunAt,
      lease: input.lease,
      actor: input.actor
    });
    if (!result) continue;
    if (result.run.status === "skipped") {
      await pruneServiceScheduleRuns(result.schedule.id, result.schedule.retentionCount);
    }
    created.push(serializeServiceScheduleRun(result.run));
  }
  return created;
}

async function claimDueServiceScheduleOccurrence(input: {
  scheduleId: string;
  scheduledFor: Date | null;
  lease: MonitorLeaseReference;
  actor: ServiceScheduleActor;
}) {
  const scheduledFor = input.scheduledFor;
  if (!scheduledFor) return null;

  return db.transaction(async (tx) => {
    const [observedSchedule] = await tx
      .select()
      .from(serviceSchedules)
      .where(
        and(
          eq(serviceSchedules.id, input.scheduleId),
          eq(serviceSchedules.status, "active"),
          eq(serviceSchedules.enabled, true),
          eq(serviceSchedules.nextRunAt, scheduledFor)
        )
      )
      .limit(1)
      .for("update");
    if (!observedSchedule) return null;

    // Lock the work item before the lease. A schedule lock can be held by
    // unrelated work for longer than the lease TTL, so the lease must remain
    // available for takeover and be revalidated only after that wait.
    const [lease] = await tx
      .select()
      .from(serviceScheduleMonitorLeases)
      .where(eq(serviceScheduleMonitorLeases.key, input.lease.key))
      .limit(1)
      .for("update");
    const clock = await tx.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);
    const nowValue = clock.rows[0]?.now;
    const databaseNow = nowValue instanceof Date ? nowValue : new Date(String(nowValue));
    if (
      !lease ||
      lease.holderInstanceId !== input.lease.holderInstanceId ||
      lease.generation !== input.lease.generation ||
      lease.expiresAt.getTime() <= databaseNow.getTime()
    ) {
      return null;
    }

    const nextRunAt = computeNextRunAt(
      observedSchedule.cronExpression,
      scheduledFor,
      observedSchedule.timezone
    );
    const [schedule] = await tx
      .update(serviceSchedules)
      .set({ nextRunAt, updatedAt: databaseNow })
      .where(
        and(
          eq(serviceSchedules.id, observedSchedule.id),
          eq(serviceSchedules.nextRunAt, scheduledFor)
        )
      )
      .returning();
    if (!schedule) return null;

    const [overlappingRun] = await tx
      .select({ id: serviceScheduleRuns.id })
      .from(serviceScheduleRuns)
      .where(
        and(
          eq(serviceScheduleRuns.scheduleId, schedule.id),
          eq(serviceScheduleRuns.triggerKind, "scheduled"),
          inArray(serviceScheduleRuns.status, ["queued", "running"])
        )
      )
      .limit(1);
    const skipped = Boolean(overlappingRun);
    const [run] = await tx
      .insert(serviceScheduleRuns)
      .values({
        id: newId(),
        scheduleId: schedule.id,
        serviceId: schedule.serviceId,
        triggerKind: "scheduled",
        scheduledFor,
        leaseGeneration: input.lease.generation,
        leaseHolderInstanceId: input.lease.holderInstanceId,
        runnerInstanceId: input.lease.holderInstanceId,
        status: skipped ? "skipped" : "queued",
        command: schedule.command,
        logs: skipped
          ? "Skipped scheduled occurrence because an earlier scheduled run is still queued or running."
          : "Queued for service schedule runner handoff.",
        result: skipped
          ? {
              outcome: "skipped",
              reason: "An earlier scheduled run is still queued or running.",
              scheduledFor: scheduledFor.toISOString()
            }
          : {},
        requestedByUserId: null,
        requestedByEmail: input.actor.requestedByEmail,
        requestedByRole: input.actor.requestedByRole,
        updatedAt: databaseNow
      })
      .returning();
    if (!run) throw new Error("Unable to record the scheduled service occurrence.");

    await tx.insert(auditEntries).values(
      buildServiceScheduleAuditEntry({
        schedule,
        actor: input.actor,
        action: "service_schedule.run_scheduled",
        summary: [
          `Recorded scheduled occurrence ${scheduledFor.toISOString()} for schedule ${schedule.name}.`,
          `Monitor holder ${input.lease.holderInstanceId} generation ${input.lease.generation}.`,
          skipped
            ? "Skipped because an earlier scheduled run is still queued or running."
            : "Queued for runner handoff."
        ].join(" "),
        runId: run.id
      })
    );

    return { schedule, run };
  });
}

export async function pruneServiceScheduleRuns(scheduleId: string, retentionCount: number) {
  const keptRunCount = Math.max(1, retentionCount);
  const rows = await db
    .select({ id: serviceScheduleRuns.id })
    .from(serviceScheduleRuns)
    .where(
      and(
        eq(serviceScheduleRuns.scheduleId, scheduleId),
        inArray(serviceScheduleRuns.status, ["succeeded", "failed", "skipped"])
      )
    )
    .orderBy(desc(serviceScheduleRuns.createdAt), desc(serviceScheduleRuns.id));
  const staleIds = rows.slice(keptRunCount).map((row) => row.id);
  if (staleIds.length === 0) return;
  await db.delete(serviceScheduleRuns).where(inArray(serviceScheduleRuns.id, staleIds));
}
