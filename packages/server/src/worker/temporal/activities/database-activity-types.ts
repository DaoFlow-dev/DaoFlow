export type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export interface DatabaseDumpInput {
  /** Container name or ID to exec into */
  containerName: string;
  /** Database engine type */
  engine: DatabaseEngine;
  /** Database name to dump */
  databaseName?: string;
  /** Database user (default: auto-detected from container env) */
  user?: string;
  /** Database password (default: auto-detected from container env) */
  password?: string;
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
  error?: string;
}

export interface ContainerLifecycleResult {
  success: boolean;
  containerName: string;
  action: "stop" | "start";
  previousState?: string;
  error?: string;
}
