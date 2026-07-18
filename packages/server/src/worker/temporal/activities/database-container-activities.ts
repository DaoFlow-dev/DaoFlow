import { execFileSync } from "node:child_process";
import { dockerCommand, withCommandPath } from "../../command-env";
import type { ContainerLifecycleResult, DatabaseEngine } from "./database-activity-types";

export function stopContainer(containerName: string): Promise<ContainerLifecycleResult> {
  try {
    const state = execFileSync(
      dockerCommand,
      ["inspect", "--format", "{{.State.Status}}", containerName],
      {
        encoding: "utf-8",
        timeout: 10_000,
        env: withCommandPath(process.env)
      }
    ).trim();

    if (state === "running") {
      execFileSync(dockerCommand, ["stop", "--time", "30", containerName], {
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
        env: withCommandPath(process.env)
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

export function startContainer(containerName: string): Promise<ContainerLifecycleResult> {
  try {
    execFileSync(dockerCommand, ["start", containerName], {
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: withCommandPath(process.env)
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

export function detectDatabaseEngine(containerName: string): Promise<DatabaseEngine | null> {
  try {
    const image = execFileSync(
      dockerCommand,
      ["inspect", "--format", "{{.Config.Image}}", containerName],
      {
        encoding: "utf-8",
        timeout: 10_000,
        env: withCommandPath(process.env)
      }
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
