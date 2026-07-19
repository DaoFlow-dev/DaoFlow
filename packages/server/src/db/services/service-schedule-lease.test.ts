import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { serviceScheduleMonitorLeases } from "../schema/service-schedules";
import { resetTestDatabase } from "../../test-db";
import {
  acquireServiceScheduleMonitorLease,
  getServiceScheduleMonitorLeaseStatus,
  isCurrentServiceScheduleMonitorLease,
  releaseServiceScheduleMonitorLease,
  SERVICE_SCHEDULE_MONITOR_LEASE_KEY
} from "./service-schedule-lease";

describe("service schedule monitor lease", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("allows one concurrent holder and renews only that holder's generation", async () => {
    const [first, second] = await Promise.all([
      acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" }),
      acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-b" })
    ]);
    const acquired = [first, second].filter((lease) => lease !== null);

    expect(acquired).toHaveLength(1);
    const lease = acquired[0];
    const renewed = await acquireServiceScheduleMonitorLease({
      holderInstanceId: lease.holderInstanceId
    });

    expect(renewed).toMatchObject({
      key: SERVICE_SCHEDULE_MONITOR_LEASE_KEY,
      holderInstanceId: lease.holderInstanceId,
      generation: lease.generation,
      acquiredAt: lease.acquiredAt
    });
    expect(renewed!.renewedAt.getTime()).toBeGreaterThanOrEqual(lease.renewedAt.getTime());
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(lease.expiresAt.getTime());
  });

  it("uses database time for active decisions and increments generation after expiry", async () => {
    const first = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(first).not.toBeNull();

    expect(await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-b" })).toBeNull();

    await db
      .update(serviceScheduleMonitorLeases)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(serviceScheduleMonitorLeases.key, SERVICE_SCHEDULE_MONITOR_LEASE_KEY));
    const replacement = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-b" });

    expect(replacement).toMatchObject({
      holderInstanceId: "monitor-b",
      generation: first!.generation + 1
    });
    expect(await isCurrentServiceScheduleMonitorLease(first!)).toBe(false);
    expect(await releaseServiceScheduleMonitorLease(first!)).toBe(false);
  });

  it("reports a serializable database-clock status and releases only its own generation", async () => {
    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(lease).not.toBeNull();

    const activeStatus = await getServiceScheduleMonitorLeaseStatus();
    expect(activeStatus).toMatchObject({
      key: SERVICE_SCHEDULE_MONITOR_LEASE_KEY,
      holderInstanceId: "monitor-a",
      generation: lease!.generation,
      active: true
    });
    expect(activeStatus?.leaseAgeMs).toBeGreaterThanOrEqual(0);
    expect(activeStatus?.renewalAgeMs).toBeGreaterThanOrEqual(0);
    expect(activeStatus?.expiresInMs).toBeGreaterThan(0);
    expect(typeof activeStatus?.acquiredAt).toBe("string");

    const renewedAtBeforeRelease = activeStatus?.renewedAt;
    expect(await releaseServiceScheduleMonitorLease(lease!)).toBe(true);
    const releasedStatus = await getServiceScheduleMonitorLeaseStatus();
    expect(releasedStatus).toMatchObject({ active: false, expiresInMs: 0 });
    expect(releasedStatus?.renewedAt).toBe(renewedAtBeforeRelease);
    expect(await releaseServiceScheduleMonitorLease(lease!)).toBe(false);
  });

  it("rejects monitor holder identifiers above the schema limit", async () => {
    await expect(
      acquireServiceScheduleMonitorLease({
        holderInstanceId: "monitor-instance-name-that-is-deliberately-too-long"
      })
    ).rejects.toThrow("must be 1-32 characters");
  });
});
