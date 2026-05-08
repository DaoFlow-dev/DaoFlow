import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerCommand, withCommandPath } from "../../command-env";
import type { DatabaseDumpInput, DatabaseDumpResult } from "./database-activity-types";
import { computeChecksumStream } from "./database-file-activities";

const DUMP_DIR = join(tmpdir(), "daoflow-dumps");

function ensureDumpDir(): string {
  if (!existsSync(DUMP_DIR)) {
    mkdirSync(DUMP_DIR, { recursive: true });
  }
  return DUMP_DIR;
}

export async function executeDatabaseDump(input: DatabaseDumpInput): Promise<DatabaseDumpResult> {
  const startTime = Date.now();
  const dumpDir = ensureDumpDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = input.engine === "mongo" ? "archive" : "sql";
  const dumpFile = join(dumpDir, `${input.containerName}-${timestamp}.${extension}`);

  try {
    const { dockerArgs, envArgs } = buildDockerExecArgs(input);
    const fullArgs = ["exec", ...envArgs, input.containerName, ...dockerArgs];

    await new Promise<void>((resolve, reject) => {
      const outStream = createWriteStream(dumpFile, { mode: 0o600 });
      const proc = spawn(dockerCommand, fullArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: withCommandPath(process.env),
        timeout: 600_000
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
