export type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export interface DatabaseDumpInput {
  /** Volume that owns database metadata. Passwords are loaded inside this activity. */
  volumeId: string;
  /** Container name or ID to exec into */
  containerName: string;
  /** Database engine type */
  engine: DatabaseEngine;
  /** Database name to dump */
  databaseName?: string;
  /** Database user (default: auto-detected from container env) */
  user?: string;
  /** Port override (default: engine default) */
  port?: number;
  /** Custom dump options (e.g., --no-owner, --schema-only) */
  extraArgs?: string[];
}

export interface DatabaseDumpResult {
  success: boolean;
  dumpPath: string;
  sizeBytes: number;
  checksum: string;
  durationMs: number;
  artifactFormat?: string;
  databaseEngineVersion?: string;
  databaseImageReference?: string;
  error?: string;
}

export interface ContainerLifecycleResult {
  success: boolean;
  containerName: string;
  action: "stop" | "start";
  previousState?: string;
  error?: string;
}
