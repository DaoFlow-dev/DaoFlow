import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../connection";
import { serviceScheduleMonitorLeases } from "../schema/service-schedules";

export const SERVICE_SCHEDULE_MONITOR_LEASE_KEY = "service-schedule-monitor";

const DEFAULT_SERVICE_SCHEDULE_MONITOR_LEASE_MS = 90_000;
const MIN_SERVICE_SCHEDULE_MONITOR_LEASE_MS = 5_000;
const LEASE_IDENTIFIER_MAX_LENGTH = 32;

export interface ServiceScheduleMonitorLease {
  key: string;
  holderInstanceId: string;
  generation: number;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
}

export interface ServiceScheduleMonitorLeaseStatus {
  key: string;
  holderInstanceId: string;
  generation: number;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
  active: boolean;
  leaseAgeMs: number;
  renewalAgeMs: number;
  expiresInMs: number;
}

type LeaseStatusRow = {
  key: string;
  holderInstanceId: string;
  generation: number;
  acquiredAt: Date | string;
  renewedAt: Date | string;
  expiresAt: Date | string;
  databaseNow: Date | string;
};

type LeaseRow = Omit<ServiceScheduleMonitorLease, "acquiredAt" | "renewedAt" | "expiresAt"> & {
  acquiredAt: Date | string;
  renewedAt: Date | string;
  expiresAt: Date | string;
} & Record<string, unknown>;

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Lease timestamp was not a valid date.");
  return date;
}

function requireHolderInstanceId(value: string): string {
  const holderInstanceId = value.trim();
  if (!holderInstanceId || holderInstanceId.length > LEASE_IDENTIFIER_MAX_LENGTH) {
    throw new Error(
      `Service schedule monitor holder instance id must be 1-${LEASE_IDENTIFIER_MAX_LENGTH} characters.`
    );
  }
  return holderInstanceId;
}

function requireLeaseKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > LEASE_IDENTIFIER_MAX_LENGTH) {
    throw new Error(
      `Service schedule monitor lease key must be 1-${LEASE_IDENTIFIER_MAX_LENGTH} characters.`
    );
  }
  return key;
}

function normalizeLease(row: LeaseRow): ServiceScheduleMonitorLease {
  return {
    key: row.key,
    holderInstanceId: row.holderInstanceId,
    generation: row.generation,
    acquiredAt: asDate(row.acquiredAt),
    renewedAt: asDate(row.renewedAt),
    expiresAt: asDate(row.expiresAt)
  };
}

function elapsedMs(later: Date, earlier: Date) {
  return Math.max(0, later.getTime() - earlier.getTime());
}

export function getServiceScheduleMonitorLeaseDurationMs(
  rawValue = process.env.DAOFLOW_SERVICE_SCHEDULE_MONITOR_LEASE_MS
): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed >= MIN_SERVICE_SCHEDULE_MONITOR_LEASE_MS
    ? parsed
    : DEFAULT_SERVICE_SCHEDULE_MONITOR_LEASE_MS;
}

/**
 * Acquires an idle lease, renews the caller's active generation, or takes over
 * an expired lease. Every decision and timestamp is made by PostgreSQL.
 */
export async function acquireServiceScheduleMonitorLease(input: {
  holderInstanceId: string;
  key?: string;
  leaseDurationMs?: number;
}): Promise<ServiceScheduleMonitorLease | null> {
  const key = requireLeaseKey(input.key ?? SERVICE_SCHEDULE_MONITOR_LEASE_KEY);
  const holderInstanceId = requireHolderInstanceId(input.holderInstanceId);
  const leaseDurationMs = input.leaseDurationMs ?? getServiceScheduleMonitorLeaseDurationMs();
  const result = await db.execute<LeaseRow>(sql`
    INSERT INTO service_schedule_monitor_leases (
      lease_key,
      holder_instance_id,
      generation,
      acquired_at,
      renewed_at,
      expires_at
    )
    VALUES (
      ${key},
      ${holderInstanceId},
      1,
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond')
    )
    ON CONFLICT (lease_key) DO UPDATE
    SET
      holder_instance_id = EXCLUDED.holder_instance_id,
      generation = CASE
        WHEN service_schedule_monitor_leases.expires_at <= clock_timestamp()
          THEN service_schedule_monitor_leases.generation + 1
        ELSE service_schedule_monitor_leases.generation
      END,
      acquired_at = CASE
        WHEN service_schedule_monitor_leases.expires_at <= clock_timestamp()
          THEN clock_timestamp()
        ELSE service_schedule_monitor_leases.acquired_at
      END,
      renewed_at = clock_timestamp(),
      expires_at = clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond')
    WHERE
      (
        service_schedule_monitor_leases.holder_instance_id = EXCLUDED.holder_instance_id
        AND service_schedule_monitor_leases.expires_at > clock_timestamp()
      )
      OR service_schedule_monitor_leases.expires_at <= clock_timestamp()
    RETURNING
      lease_key AS "key",
      holder_instance_id AS "holderInstanceId",
      generation,
      acquired_at AS "acquiredAt",
      renewed_at AS "renewedAt",
      expires_at AS "expiresAt"
  `);

  const row = result.rows[0];
  return row ? normalizeLease(row) : null;
}

export async function isCurrentServiceScheduleMonitorLease(
  lease: Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation">
): Promise<boolean> {
  const [current] = await db
    .select({ key: serviceScheduleMonitorLeases.key })
    .from(serviceScheduleMonitorLeases)
    .where(
      and(
        eq(serviceScheduleMonitorLeases.key, lease.key),
        eq(serviceScheduleMonitorLeases.holderInstanceId, lease.holderInstanceId),
        eq(serviceScheduleMonitorLeases.generation, lease.generation),
        gt(serviceScheduleMonitorLeases.expiresAt, sql<Date>`clock_timestamp()`)
      )
    )
    .limit(1);
  return Boolean(current);
}

/**
 * Extends only the caller's still-current generation. Unlike acquisition, a
 * delayed heartbeat can never create a new generation after its lease expires.
 */
export async function renewServiceScheduleMonitorLease(input: {
  lease: Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation">;
  leaseDurationMs: number;
}): Promise<ServiceScheduleMonitorLease | null> {
  const result = await db.execute<LeaseRow>(sql`
    UPDATE service_schedule_monitor_leases
    SET
      renewed_at = clock_timestamp(),
      expires_at = clock_timestamp() + (${input.leaseDurationMs} * interval '1 millisecond')
    WHERE lease_key = ${input.lease.key}
      AND holder_instance_id = ${input.lease.holderInstanceId}
      AND generation = ${input.lease.generation}
      AND expires_at > clock_timestamp()
    RETURNING
      lease_key AS "key",
      holder_instance_id AS "holderInstanceId",
      generation,
      acquired_at AS "acquiredAt",
      renewed_at AS "renewedAt",
      expires_at AS "expiresAt"
  `);

  const row = result.rows[0];
  return row ? normalizeLease(row) : null;
}

/**
 * Marks only the caller's still-current generation expired. It intentionally
 * leaves the holder and generation visible for operational diagnosis.
 */
export async function releaseServiceScheduleMonitorLease(
  lease: Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation">
): Promise<boolean> {
  const [released] = await db
    .update(serviceScheduleMonitorLeases)
    .set({
      expiresAt: sql<Date>`clock_timestamp()`
    })
    .where(
      and(
        eq(serviceScheduleMonitorLeases.key, lease.key),
        eq(serviceScheduleMonitorLeases.holderInstanceId, lease.holderInstanceId),
        eq(serviceScheduleMonitorLeases.generation, lease.generation),
        gt(serviceScheduleMonitorLeases.expiresAt, sql<Date>`clock_timestamp()`)
      )
    )
    .returning({ key: serviceScheduleMonitorLeases.key });
  return Boolean(released);
}

/**
 * Returns a database-clock-based status for operator tooling. The timestamps
 * are serialized so callers can expose this without depending on ORM values.
 */
export async function getServiceScheduleMonitorLeaseStatus(
  key = SERVICE_SCHEDULE_MONITOR_LEASE_KEY
): Promise<ServiceScheduleMonitorLeaseStatus | null> {
  const result = await db.execute<LeaseStatusRow>(sql`
    SELECT
      lease_key AS "key",
      holder_instance_id AS "holderInstanceId",
      generation,
      acquired_at AS "acquiredAt",
      renewed_at AS "renewedAt",
      expires_at AS "expiresAt",
      clock_timestamp() AS "databaseNow"
    FROM service_schedule_monitor_leases
    WHERE lease_key = ${key}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;

  const acquiredAt = asDate(row.acquiredAt);
  const renewedAt = asDate(row.renewedAt);
  const expiresAt = asDate(row.expiresAt);
  const databaseNow = asDate(row.databaseNow);
  const active = expiresAt.getTime() > databaseNow.getTime();

  return {
    key: row.key,
    holderInstanceId: row.holderInstanceId,
    generation: row.generation,
    acquiredAt: acquiredAt.toISOString(),
    renewedAt: renewedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    active,
    leaseAgeMs: elapsedMs(databaseNow, acquiredAt),
    renewalAgeMs: elapsedMs(databaseNow, renewedAt),
    expiresInMs: active ? elapsedMs(expiresAt, databaseNow) : 0
  };
}
