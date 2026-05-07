import type { ManagedDatabaseKind } from "@daoflow/shared";

export interface ManagedDatabaseConfigInput {
  kind: ManagedDatabaseKind;
  label: string;
  templateSlug: string;
  databaseName: string | null;
  username: string | null;
  port: string;
  internalPort: string;
  serviceName: string;
  volumeName: string;
  volumeId?: string | null;
  backupPolicyId?: string | null;
  backupType?: "database" | "volume";
  backupEngine?: string | null;
  connectionUriMasked: string;
  internalConnectionUriMasked: string;
}

export interface ManagedDatabaseConfig extends ManagedDatabaseConfigInput {
  managedBy: "daoflow";
  createdFrom: "managed-database";
}

function asConfigRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function writeManagedDatabaseConfigToConfig(input: {
  config: unknown;
  managedDatabase?: ManagedDatabaseConfigInput | null;
}): Record<string, unknown> {
  const config = { ...asConfigRecord(input.config) };
  if (input.managedDatabase === undefined) {
    return config;
  }

  if (input.managedDatabase === null) {
    delete config.managedDatabase;
    return config;
  }

  config.managedDatabase = {
    ...input.managedDatabase,
    managedBy: "daoflow",
    createdFrom: "managed-database"
  } satisfies ManagedDatabaseConfig;
  return config;
}

export function readManagedDatabaseConfigFromConfig(config: unknown): ManagedDatabaseConfig | null {
  const managed = asConfigRecord(config).managedDatabase;
  if (!managed || typeof managed !== "object" || Array.isArray(managed)) {
    return null;
  }

  const record = managed as Record<string, unknown>;
  const kind = readString(record, "kind") as ManagedDatabaseKind | null;
  const label = readString(record, "label");
  const templateSlug = readString(record, "templateSlug");
  const port = readString(record, "port");
  const internalPort = readString(record, "internalPort");
  const serviceName = readString(record, "serviceName");
  const volumeName = readString(record, "volumeName");
  const connectionUriMasked = readString(record, "connectionUriMasked");
  const internalConnectionUriMasked = readString(record, "internalConnectionUriMasked");

  if (
    !kind ||
    !label ||
    !templateSlug ||
    !port ||
    !internalPort ||
    !serviceName ||
    !volumeName ||
    !connectionUriMasked ||
    !internalConnectionUriMasked
  ) {
    return null;
  }

  return {
    kind,
    label,
    templateSlug,
    databaseName: readString(record, "databaseName"),
    username: readString(record, "username"),
    port,
    internalPort,
    serviceName,
    volumeName,
    volumeId: readString(record, "volumeId"),
    backupPolicyId: readString(record, "backupPolicyId"),
    backupType: readString(record, "backupType") === "volume" ? "volume" : "database",
    backupEngine: readString(record, "backupEngine"),
    connectionUriMasked,
    internalConnectionUriMasked,
    managedBy: "daoflow",
    createdFrom: "managed-database"
  };
}
