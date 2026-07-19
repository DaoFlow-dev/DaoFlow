import { and, eq } from "drizzle-orm";
import { db } from "./connection";
import { backupDestinations } from "./schema/destinations";
import { environments, projects } from "./schema/projects";
import { servers } from "./schema/servers";
import { services } from "./schema/services";
import { backupPolicies, backupRestores, backupRuns, volumes } from "./schema/storage";

interface RealInfraBackupHistory {
  backupRunId?: string;
  restoreId?: string;
}

export interface RealInfraControlPlaneRecords extends RealInfraBackupHistory {
  policyId?: string;
  volumeId?: string;
  destinationId?: string;
  serviceId?: string;
  environmentId?: string;
  projectId?: string;
  serverId?: string;
}

export async function deleteRealInfraBackupHistory(input: RealInfraBackupHistory): Promise<void> {
  assertDedicatedRealInfraDatabase();
  if (input.restoreId) {
    assertSafeId(input.restoreId);
    if (!input.backupRunId)
      throw new Error("Real-infrastructure restore cleanup requires its run.");
    assertSafeId(input.backupRunId);
    await db
      .delete(backupRestores)
      .where(
        and(
          eq(backupRestores.id, input.restoreId),
          eq(backupRestores.backupRunId, input.backupRunId)
        )
      );
  }
  if (input.backupRunId) {
    assertSafeId(input.backupRunId);
    await db.delete(backupRuns).where(eq(backupRuns.id, input.backupRunId));
  }
}

export async function assertRealInfraControlPlaneRecordsRemoved(
  input: RealInfraControlPlaneRecords
): Promise<void> {
  assertDedicatedRealInfraDatabase();
  const remaining: string[] = [];
  await checkRecord(remaining, "restore", input.restoreId, async (id) =>
    db
      .select({ id: backupRestores.id })
      .from(backupRestores)
      .where(eq(backupRestores.id, id))
      .limit(1)
  );
  await checkRecord(remaining, "backup-run", input.backupRunId, async (id) =>
    db.select({ id: backupRuns.id }).from(backupRuns).where(eq(backupRuns.id, id)).limit(1)
  );
  await checkRecord(remaining, "backup-policy", input.policyId, async (id) =>
    db
      .select({ id: backupPolicies.id })
      .from(backupPolicies)
      .where(eq(backupPolicies.id, id))
      .limit(1)
  );
  await checkRecord(remaining, "volume", input.volumeId, async (id) =>
    db.select({ id: volumes.id }).from(volumes).where(eq(volumes.id, id)).limit(1)
  );
  await checkRecord(remaining, "backup-destination", input.destinationId, async (id) =>
    db
      .select({ id: backupDestinations.id })
      .from(backupDestinations)
      .where(eq(backupDestinations.id, id))
      .limit(1)
  );
  await checkRecord(remaining, "service", input.serviceId, async (id) =>
    db.select({ id: services.id }).from(services).where(eq(services.id, id)).limit(1)
  );
  await checkRecord(remaining, "environment", input.environmentId, async (id) =>
    db.select({ id: environments.id }).from(environments).where(eq(environments.id, id)).limit(1)
  );
  await checkRecord(remaining, "project", input.projectId, async (id) =>
    db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1)
  );
  await checkRecord(remaining, "server", input.serverId, async (id) =>
    db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).limit(1)
  );
  if (remaining.length > 0) {
    throw new Error(`Control-plane records remain after cleanup: ${remaining.join(", ")}`);
  }
}

async function checkRecord(
  remaining: string[],
  kind: string,
  id: string | undefined,
  query: (id: string) => Promise<unknown[]>
): Promise<void> {
  if (!id) return;
  assertSafeId(id);
  if ((await query(id)).length > 0) remaining.push(`${kind}:${id}`);
}

function assertDedicatedRealInfraDatabase(): void {
  const harnessUrl = process.env.PLAYWRIGHT_REAL_INFRA_DATABASE_URL;
  if (
    process.env.DAOFLOW_REAL_INFRA !== "1" ||
    !harnessUrl ||
    process.env.DATABASE_URL !== harnessUrl
  ) {
    throw new Error("Real-infrastructure history cleanup requires its dedicated test database.");
  }
}

function assertSafeId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Real-infrastructure history cleanup received an unsafe identifier.");
  }
}
