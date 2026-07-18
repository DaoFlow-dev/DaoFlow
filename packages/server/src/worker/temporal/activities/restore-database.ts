import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { dockerCommand, withCommandPath } from "../../command-env";
import { processRunner } from "../../process-runner";
import type { RestoreResolved } from "./restore-activities";
import { findLargestFile } from "./restore-files";
import type { RestoreExecutionResult } from "./restore-execution";

interface DockerRestoreCommand {
  envArgs: string[];
  args: string[];
}

type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export async function executeDatabaseRestore(
  ctx: RestoreResolved,
  localPath: string
): Promise<RestoreExecutionResult> {
  try {
    const engine = normalizeDatabaseEngine(ctx.databaseEngine);
    if (!engine) {
      return {
        success: false,
        bytesRestored: 0,
        error: `Unsupported database restore engine: ${ctx.databaseEngine ?? "missing"}`
      };
    }

    const dumpFile = findLargestFile(localPath);
    if (!dumpFile) {
      return {
        success: false,
        bytesRestored: 0,
        error: `No database dump file was downloaded to ${localPath}`
      };
    }

    const containerName = resolveDatabaseContainer(ctx);
    if (!containerName) {
      return {
        success: false,
        bytesRestored: 0,
        error:
          "Unable to resolve a database container. Set volume metadata.containerName or metadata.serviceName before restoring."
      };
    }

    await runDockerDatabaseRestore(containerName, buildRestoreCommand(ctx, engine), dumpFile);
    return { success: true, bytesRestored: statSync(dumpFile).size };
  } catch (err) {
    return {
      success: false,
      bytesRestored: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function normalizeDatabaseEngine(engine: string | undefined): DatabaseEngine | null {
  if (engine === "postgres" || engine === "mysql" || engine === "mariadb" || engine === "mongo") {
    return engine;
  }
  return null;
}

function buildRestoreCommand(ctx: RestoreResolved, engine: DatabaseEngine): DockerRestoreCommand {
  switch (engine) {
    case "postgres": {
      const envArgs = ctx.databasePassword ? ["-e", `PGPASSWORD=${ctx.databasePassword}`] : [];
      return {
        envArgs,
        args: [
          "pg_restore",
          "-U",
          ctx.databaseUser ?? "postgres",
          "-d",
          ctx.databaseName ?? "postgres",
          "--clean",
          "--if-exists",
          "--no-owner"
        ]
      };
    }
    case "mysql":
    case "mariadb": {
      const envArgs = ctx.databasePassword ? ["-e", `MYSQL_PWD=${ctx.databasePassword}`] : [];
      const databaseArgs = ctx.databaseName ? [ctx.databaseName] : [];
      return {
        envArgs,
        args: ["mysql", "-u", ctx.databaseUser ?? "root", ...databaseArgs]
      };
    }
    case "mongo": {
      const args = ["mongorestore", "--archive", "--gzip"];
      if (ctx.databaseUser) {
        args.push(`--username=${ctx.databaseUser}`, "--authenticationDatabase=admin");
      }
      if (ctx.databasePassword) {
        args.push(`--password=${ctx.databasePassword}`);
      }
      if (ctx.databaseName) {
        args.push(`--nsInclude=${ctx.databaseName}.*`);
      }
      return { envArgs: [], args };
    }
  }
}

function runDockerDatabaseRestore(
  containerName: string,
  command: DockerRestoreCommand,
  dumpFile: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["exec", "-i", ...command.envArgs, containerName, ...command.args];
    const input = createReadStream(dumpFile);
    const proc = spawn(dockerCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: withCommandPath(process.env)
    });
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Database restore timed out after 30 minutes"));
    }, 1_800_000);
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker exec restore exited with code ${code}: ${stderr.slice(0, 500)}`));
    });

    input.on("error", (error) => {
      proc.kill("SIGTERM");
      clearTimeout(timeout);
      reject(error);
    });
    input.pipe(proc.stdin);
  });
}

function resolveDatabaseContainer(ctx: RestoreResolved): string | null {
  if (ctx.containerName) {
    return ctx.containerName;
  }

  for (const candidate of [ctx.serviceName, ctx.volumeName].filter(Boolean)) {
    const byComposeService = firstDockerContainer([
      "ps",
      "--format",
      "{{.Names}}",
      "--filter",
      `label=com.docker.compose.service=${candidate}`
    ]);
    if (byComposeService) {
      return byComposeService;
    }

    const byName = firstDockerContainer([
      "ps",
      "--format",
      "{{.Names}}",
      "--filter",
      `name=${candidate}`
    ]);
    if (byName) {
      return byName;
    }
  }

  return null;
}

function firstDockerContainer(args: string[]): string | null {
  try {
    const output = processRunner.execFileSync(dockerCommand, args, {
      encoding: "utf-8",
      timeout: 10_000,
      env: withCommandPath(process.env)
    });
    return (
      output
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

export const restoreDatabaseTestHooks = {
  buildRestoreCommand,
  normalizeDatabaseEngine
};
