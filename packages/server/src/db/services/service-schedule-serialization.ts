import { asRecord } from "./json-helpers";
import type { serviceScheduleRuns, serviceSchedules } from "../schema/service-schedules";

export function serializeServiceSchedule(row: typeof serviceSchedules.$inferSelect) {
  return {
    ...row,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null
  };
}

export function serializeServiceScheduleRun(row: typeof serviceScheduleRuns.$inferSelect) {
  return {
    ...row,
    result: asRecord(row.result),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  };
}
