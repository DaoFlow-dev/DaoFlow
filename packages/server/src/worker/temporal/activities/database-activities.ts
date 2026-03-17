/**
 * Database backup activities for Temporal workflows.
 *
 * Provides database-native dump activities (pg_dump, mysqldump, mongodump)
 * and container lifecycle management (stop/start) for data consistency.
 *
 * Security: Uses array-based docker exec args (no shell interpolation).
 * Memory: Streams dumps to disk via spawn (no buffer-based capture).
 */

import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  createReadStream,
  createWriteStream,
  statSync,
  unlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────────

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

// ── Database Dump Activities ─────────────────────────────────

const DUMP_DIR = join(tmpdir(), "daoflow-dumps");

function ensureDumpDir(): string {
  if (!existsSync(DUMP_DIR)) {
    mkdirSync(DUMP_DIR, { recursive: true });
  }
  return DUMP_DIR;
}

/**
 * Compute SHA-256 checksum of a file using streaming (memory-safe).
 */
function computeChecksumStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Execute a database dump via `docker exec` on the target container.
 *
 * Security: Uses array-based args (no shell interpolation).
 * Memory: Streams stdout directly to a file (no buffering).
 * Credentials: Passed via -e environment variables to docker exec.
 */
export async function executeDatabaseDump(input: DatabaseDumpInput): Promise<DatabaseDumpResult> {
  const startTime = Date.now();
  const dumpDir = ensureDumpDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = input.engine === "mongo" ? "archive" : "sql";
  const dumpFile = join(dumpDir, `${input.containerName}-${timestamp}.${extension}`);

  try {
    const { dockerArgs, envArgs } = buildDockerExecArgs(input);

    // Build full docker exec command with env vars
    const fullArgs = ["exec", ...envArgs, input.containerName, ...dockerArgs];

    // Stream stdout directly to file (memory-safe for large dumps)
    await new Promise<void>((resolve, reject) => {
      const outStream = createWriteStream(dumpFile, { mode: 0o600 });
      const proc = spawn("docker", fullArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 600_000 // 10 min
      });

      proc.stdout.pipe(outStream);

      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`docker exec exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", reject);
    });

    const stats = statSync(dumpFile);
    const checksum = await computeChecksumStream(dumpFile);

    return {
      success: true,
      dumpPath: dumpFile,
      sizeBytes: stats.size,
      checksum,
      durationMs: Date.now() - startTime
    };
  } catch (err) {
    // Clean up partial dump file on failure
    try {
      if (existsSync(dumpFile)) unlinkSync(dumpFile);
    } catch {
      /* ignore cleanup errors */
    }
    return {
      success: false,
      dumpPath: dumpFile,
      sizeBytes: 0,
      checksum: "",
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Build docker exec args for database dump (array-based, no shell interpolation).
 * Credentials are passed via docker exec -e flags for security.
 */
function buildDockerExecArgs(input: DatabaseDumpInput): {
  dockerArgs: string[];
  envArgs: string[];
} {
  const { engine, databaseName, user, port, extraArgs = [] } = input;

  switch (engine) {
    case "postgres": {
      const pgUser = user ?? "postgres";
      const pgDb = databaseName ?? "postgres";
      const pgPort = port ?? 5432;
      const envArgs: string[] = [];
      if (input.password) {
        envArgs.push("-e", `PGPASSWORD=${input.password}`);
      }
      return {
        dockerArgs: [
          "pg_dump",
          "-U",
          pgUser,
          "-p",
          String(pgPort),
          "--format=custom",
          "--compress=6",
          ...extraArgs,
          pgDb
        ],
        envArgs
      };
    }

    case "mysql":
    case "mariadb": {
      const myUser = user ?? "root";
      const myPort = port ?? 3306;
      const envArgs: string[] = [];
      if (input.password) {
        envArgs.push("-e", `MYSQL_PWD=${input.password}`);
      }
      const dbArgs = databaseName ? [databaseName] : ["--all-databases"];
      return {
        dockerArgs: [
          "mysqldump",
          "-u",
          myUser,
          "-P",
          String(myPort),
          "--single-transaction",
          "--routines",
          "--triggers",
          ...extraArgs,
          ...dbArgs
        ],
        envArgs
      };
    }

    case "mongo": {
      const mongoPort = port ?? 27017;
      const envArgs: string[] = [];
      const authArgs: string[] = [];
      if (user) {
        authArgs.push(`--username=${user}`);
        authArgs.push("--authenticationDatabase=admin");
      }
      if (input.password) {
        // mongodump doesn't support env-based password, but we pass as arg
        // to avoid shell interpolation since we use array args (no shell)
        authArgs.push(`--password=${input.password}`);
      }
      const dbArgs = databaseName ? [`--db=${databaseName}`] : [];
      return {
        dockerArgs: [
          "mongodump",
          "--port",
          String(mongoPort),
          "--archive",
          "--gzip",
          ...authArgs,
          ...dbArgs,
          ...extraArgs
        ],
        envArgs
      };
    }

    default:
      throw new Error(`Unsupported database engine: ${String(engine)}`);
  }
}

// ── Container Lifecycle Activities ───────────────────────────

/**
 * Stop a Docker container gracefully.
 * Returns the container's previous state for restart.
 */
export function stopContainer(containerName: string): Promise<ContainerLifecycleResult> {
  try {
    const state = (
      execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", containerName], {
        encoding: "utf-8",
        timeout: 10_000
      }) as unknown as string
    ).trim();

    if (state === "running") {
      execFileSync("docker", ["stop", "--time", "30", containerName], {
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"]
      });
    }

    return Promise.resolve({
      success: true,
      containerName,
      action: "stop",
      previousState: state
    });
  } catch (err) {
    return Promise.resolve({
      success: false,
      containerName,
      action: "stop",
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Start a previously stopped Docker container.
 */
export function startContainer(containerName: string): Promise<ContainerLifecycleResult> {
  try {
    execFileSync("docker", ["start", containerName], {
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"]
    });

    return Promise.resolve({ success: true, containerName, action: "start" });
  } catch (err) {
    return Promise.resolve({
      success: false,
      containerName,
      action: "start",
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Detect database engine from Docker container image/environment.
 */
export function detectDatabaseEngine(containerName: string): Promise<DatabaseEngine | null> {
  try {
    const image = (
      execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", containerName], {
        encoding: "utf-8",
        timeout: 10_000
      }) as unknown as string
    ).trim();

    const lower = image.toLowerCase();
    if (lower.includes("postgres") || lower.includes("pgvector")) {
      return Promise.resolve("postgres");
    }
    if (lower.includes("mysql")) return Promise.resolve("mysql");
    if (lower.includes("mariadb")) return Promise.resolve("mariadb");
    if (lower.includes("mongo")) return Promise.resolve("mongo");
    return Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Compute SHA-256 checksum of a file (streaming, memory-safe).
 */
export async function computeFileChecksum(filePath: string): Promise<string> {
  return computeChecksumStream(filePath);
}

/**
 * Clean up a local dump file after successful upload.
 */
export function cleanupDumpFile(dumpPath: string): Promise<void> {
  try {
    if (existsSync(dumpPath)) unlinkSync(dumpPath);
  } catch {
    /* ignore cleanup errors */
  }
  return Promise.resolve();
}
