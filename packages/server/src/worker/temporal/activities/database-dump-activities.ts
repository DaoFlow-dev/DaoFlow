import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { volumes } from "../../../db/schema/storage";
import { dockerCommand, withCommandPath } from "../../command-env";
import { processRunner } from "../../process-runner";
import { redactActivitySecretValue } from "./activity-secret-redaction";
import type { DatabaseDumpInput, DatabaseDumpResult } from "./database-activity-types";
import { computeChecksumStream } from "./database-file-activities";

const DUMP_DIR = join(tmpdir(), "daoflow-dumps");

type DatabaseDumpExecutionInput = DatabaseDumpInput & { password?: string };

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
  const extension =
    input.engine === "postgres" ? "dump" : input.engine === "mongo" ? "archive" : "sql";
  const dumpFile = join(dumpDir, `${input.containerName}-${timestamp}.${extension}`);
  let databasePassword: string | undefined;

  try {
    const sourceMetadata = inspectDatabaseSource(input);
    databasePassword = await readDatabasePassword(input.volumeId);
    const { dockerArgs, envArgs } = buildDockerExecArgs({
      ...input,
      password: databasePassword
    });
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
      durationMs: Date.now() - startTime,
      ...sourceMetadata
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
      error: redactActivitySecretValue(
        err instanceof Error ? err.message : String(err),
        databasePassword
      )
    };
  }
}

function inspectDatabaseSource(input: DatabaseDumpInput): {
  artifactFormat: string;
  databaseEngineVersion?: string;
  databaseImageReference?: string;
} {
  if (input.engine !== "postgres") {
    return {
      artifactFormat: input.engine === "mongo" ? "mongo-gzip-archive" : `${input.engine}-sql`
    };
  }

  const metadata: {
    artifactFormat: string;
    databaseEngineVersion?: string;
    databaseImageReference?: string;
  } = { artifactFormat: "postgres-custom" };

  try {
    const env = withCommandPath(process.env);
    const versionOutput = processRunner.execFileSync(
      dockerCommand,
      ["exec", input.containerName, "pg_dump", "--version"],
      { encoding: "utf-8", timeout: 10_000, env }
    );
    const versionMatch = /PostgreSQL\)\s+([0-9]+(?:\.[0-9]+)*)/i.exec(versionOutput);
    if (!versionMatch) return metadata;

    metadata.databaseEngineVersion = versionMatch[1];
    const imageDetails = processRunner
      .execFileSync(
        dockerCommand,
        ["inspect", "--format", "{{.Config.Image}}|{{.Image}}", input.containerName],
        { encoding: "utf-8", timeout: 10_000, env }
      )
      .trim();
    const [configuredImage = "", imageId = ""] = imageDetails.split("|");
    const imageName = configuredImage.split("@")[0];
    const sourceMajor = versionMatch[1].split(".")[0];
    const officialImage =
      /^(?:(?:docker\.io\/)?library\/)?postgres:(?<major>[1-9]\d*)(?:\.[0-9]+)*(?:-[a-z0-9][a-z0-9._-]*)?$/i.exec(
        imageName
      );
    const repositoryDigest = processRunner
      .execFileSync(
        dockerCommand,
        ["image", "inspect", "--format", "{{index .RepoDigests 0}}", imageId],
        { encoding: "utf-8", timeout: 10_000, env }
      )
      .trim()
      .split("@")[1];
    if (
      officialImage?.groups?.major === sourceMajor &&
      /^sha256:[a-f0-9]{64}$/i.test(imageId) &&
      /^sha256:[a-f0-9]{64}$/i.test(repositoryDigest ?? "")
    ) {
      metadata.databaseImageReference = `${imageName}@${repositoryDigest}`;
    }
  } catch {
    // Backup creation must not depend on verification metadata availability.
  }

  return metadata;
}

function buildDockerExecArgs(input: DatabaseDumpExecutionInput): {
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

async function readDatabasePassword(volumeId: string): Promise<string | undefined> {
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, volumeId)).limit(1);
  if (!volume) {
    throw new Error("Backup volume is no longer available.");
  }

  const metadata = volume.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const password = (metadata as Record<string, unknown>).databasePassword;
  return typeof password === "string" && password.length > 0 ? password : undefined;
}

export const databaseDumpTestHooks = {
  buildDockerExecArgs,
  inspectDatabaseSource
};
