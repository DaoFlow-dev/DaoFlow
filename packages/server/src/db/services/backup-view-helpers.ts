import { db } from "../connection";
import { backupPolicies, volumes } from "../schema/storage";
import { backupDestinations } from "../schema/destinations";
import { servers } from "../schema/servers";
import { users } from "../schema/users";
import { asRecord, readString } from "./json-helpers";

const SEEDED_POLICY_VIEW: Record<
  string,
  {
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
  }
> = {
  bpol_foundation_volume_daily: {
    projectName: "DaoFlow",
    environmentName: "production-us-west",
    serviceName: "postgres-volume",
    targetType: "volume"
  },
  bpol_foundation_db_hourly: {
    projectName: "DaoFlow",
    environmentName: "staging",
    serviceName: "control-plane-db",
    targetType: "database"
  }
};

export function getBackupOperationStatusTone(status: string) {
  if (status === "succeeded") {
    return "healthy" as const;
  }

  if (status === "failed") {
    return "failed" as const;
  }

  if (status === "running") {
    return "running" as const;
  }

  return "queued" as const;
}

export function getPersistentVolumeStatusTone(backupCoverage: string, restoreReadiness: string) {
  if (backupCoverage === "missing") {
    return "failed" as const;
  }

  if (
    backupCoverage === "stale" ||
    restoreReadiness === "stale" ||
    restoreReadiness === "untested"
  ) {
    return "running" as const;
  }

  return "healthy" as const;
}

export function getPolicyView(
  policy: typeof backupPolicies.$inferSelect,
  volume?: typeof volumes.$inferSelect,
  destination?: typeof backupDestinations.$inferSelect | null
) {
  const seeded = SEEDED_POLICY_VIEW[policy.id];
  const metadata = asRecord(volume?.metadata);

  return {
    projectName: seeded?.projectName ?? readString(metadata, "projectName"),
    environmentName: seeded?.environmentName ?? readString(metadata, "environmentName"),
    serviceName: seeded?.serviceName ?? policy.name,
    targetType: seeded?.targetType ?? ("volume" as const),
    storageProvider: destination?.provider ?? destination?.name ?? "(none)"
  };
}

export async function loadBackupRelations() {
  const [policyRows, volumeRows, serverRows, destinationRows] = await Promise.all([
    db.select().from(backupPolicies),
    db.select().from(volumes),
    db.select().from(servers),
    db.select().from(backupDestinations)
  ]);

  return {
    policiesById: new Map(policyRows.map((row) => [row.id, row])),
    volumesById: new Map(volumeRows.map((row) => [row.id, row])),
    serversById: new Map(serverRows.map((row) => [row.id, row])),
    destinationsById: new Map(destinationRows.map((row) => [row.id, row]))
  };
}

export function readRequestedByEmail(
  userId: string | null,
  usersById: Map<string, typeof users.$inferSelect>
) {
  if (!userId) {
    return "scheduler";
  }

  return usersById.get(userId)?.email ?? "scheduler";
}

export async function loadUsersById() {
  const userRows = await db.select().from(users);
  return new Map(userRows.map((user) => [user.id, user]));
}
