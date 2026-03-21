export const NO_DESTINATION = "__no_destination__";

export interface PolicyDraft {
  id?: string;
  name: string;
  volumeId: string;
  destinationId: string;
  backupType: "volume" | "database";
  databaseEngine: string;
  turnOff: boolean;
  schedule: string;
  retentionDays: string;
  status: "active" | "paused";
}

export type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export function makeDraft(
  policy?: {
    id: string;
    name: string;
    volumeId: string;
    destinationId: string | null;
    backupType: "volume" | "database";
    databaseEngine: string | null;
    turnOff: boolean;
    schedule: string | null;
    retentionDays: number;
    status: string;
  } | null
): PolicyDraft {
  return {
    id: policy?.id,
    name: policy?.name ?? "",
    volumeId: policy?.volumeId ?? "",
    destinationId: policy?.destinationId ?? NO_DESTINATION,
    backupType: policy?.backupType ?? "volume",
    databaseEngine: policy?.databaseEngine ?? "",
    turnOff: policy?.turnOff ?? false,
    schedule: policy?.schedule ?? "",
    retentionDays: policy ? String(policy.retentionDays) : "30",
    status: (policy?.status as PolicyDraft["status"]) ?? "active"
  };
}
