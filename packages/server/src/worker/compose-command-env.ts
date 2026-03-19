import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseComposeEnvFile } from "../compose-env";

export const COMPOSE_COMMAND_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "DOCKER_CONFIG",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "SSH_AUTH_SOCK",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "LANG",
  "LC_ALL"
] as const;

export interface ComposeExecutionEnvSummary {
  preservedProcessEnvKeys: string[];
  envFile?: {
    path: string;
    exists: boolean;
    entryCount: number;
  };
}

export function buildComposeCommandEnv(cwd: string, envFile?: string): Record<string, string> {
  return prepareComposeCommandEnv(cwd, envFile).env;
}

export function prepareComposeCommandEnv(
  cwd: string,
  envFile?: string
): { env: Record<string, string>; summary: ComposeExecutionEnvSummary } {
  const env: Record<string, string> = { DOCKER_CLI_HINTS: "false" };
  const preservedProcessEnvKeys: string[] = [];

  for (const key of COMPOSE_COMMAND_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
      preservedProcessEnvKeys.push(key);
    }
  }

  const summary: ComposeExecutionEnvSummary = {
    preservedProcessEnvKeys
  };

  if (!envFile) {
    return { env, summary };
  }

  const envPath = join(cwd, envFile);
  if (!existsSync(envPath)) {
    return {
      env,
      summary: {
        ...summary,
        envFile: {
          path: envFile,
          exists: false,
          entryCount: 0
        }
      }
    };
  }

  const parsed = parseComposeEnvFile(readFileSync(envPath, "utf8"));
  for (const entry of parsed.entries) {
    env[entry.key] = entry.value;
  }

  return {
    env,
    summary: {
      ...summary,
      envFile: {
        path: envFile,
        exists: true,
        entryCount: parsed.entries.length
      }
    }
  };
}

export function formatComposeExecutionEnvSummary(summary: ComposeExecutionEnvSummary): string {
  const preserved =
    summary.preservedProcessEnvKeys.length > 0
      ? summary.preservedProcessEnvKeys.join(", ")
      : "none";

  if (!summary.envFile) {
    return `Compose execution env isolated from ambient worker env (preserved process vars: ${preserved}; no env file).`;
  }

  const envFileSummary = summary.envFile.exists
    ? `${summary.envFile.path} (${summary.envFile.entryCount} entries, values redacted)`
    : `${summary.envFile.path} (missing)`;

  return `Compose execution env isolated from ambient worker env (preserved process vars: ${preserved}; env file: ${envFileSummary}).`;
}

export function formatRemoteComposeExecutionEnvSummary(envFile?: string): string {
  const preserved = COMPOSE_COMMAND_ENV_ALLOWLIST.join(", ");
  const envFileSummary = envFile ? `${envFile} (values redacted)` : "none";
  return `Compose execution env isolated from ambient remote shell env (preserved process vars: ${preserved}; env file: ${envFileSummary}).`;
}
