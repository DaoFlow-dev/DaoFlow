import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { fetchComposeYml, parseEnvFile } from "./templates";

export interface ExistingInstallState {
  dir: string;
  envPath: string;
  composePath: string;
  env: Record<string, string>;
  envContent: string;
  version: string;
  domain?: string;
  port?: number;
  scheme?: "http" | "https";
}

export interface InstallerRuntime {
  checkDocker(this: void): { available: boolean; compose: boolean; version?: string };
  exec(this: void, command: string, options?: Parameters<typeof execSync>[1]): string | Buffer;
  fetch(this: void, url: string): Promise<Response>;
  fetchComposeYml(this: void): Promise<string>;
  prompt(this: void, question: string, defaultValue?: string): Promise<string>;
  sleep(this: void, ms: number): Promise<void>;
}

export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export function checkDocker(): { available: boolean; compose: boolean; version?: string } {
  try {
    const version = execSync("docker --version", { encoding: "utf-8" }).trim();
    let compose = false;
    try {
      execSync("docker compose version", { encoding: "utf-8", stdio: "pipe" });
      compose = true;
    } catch {
      // docker compose not available
    }
    return { available: true, compose, version };
  } catch {
    return { available: false, compose: false };
  }
}

export const installerRuntime: InstallerRuntime = {
  checkDocker,
  exec: (command, options) => execSync(command, options),
  fetch: (url) => globalThis.fetch(url),
  fetchComposeYml,
  prompt,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
};

export function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

export function getInstallPaths(dir: string): { envPath: string; composePath: string } {
  return {
    envPath: join(dir, ".env"),
    composePath: join(dir, "docker-compose.yml")
  };
}

export function readExistingInstall(dir: string): ExistingInstallState | null {
  const { envPath, composePath } = getInstallPaths(dir);
  if (!existsSync(envPath)) {
    return null;
  }

  const envContent = readFileSync(envPath, "utf-8");
  const env = parseEnvFile(envContent);
  const existingUrl = env.BETTER_AUTH_URL?.trim();
  let domain: string | undefined;
  let port: number | undefined;
  let scheme: "http" | "https" | undefined;

  if (existingUrl) {
    try {
      const parsedUrl = new URL(existingUrl);
      domain = parsedUrl.hostname;
      scheme = parsedUrl.protocol === "http:" ? "http" : "https";
      port = parsePort(env.DAOFLOW_PORT ?? "") ?? undefined;
    } catch {
      domain = undefined;
      port = parsePort(env.DAOFLOW_PORT ?? "") ?? undefined;
    }
  } else {
    port = parsePort(env.DAOFLOW_PORT ?? "") ?? undefined;
  }

  return {
    dir,
    envPath,
    composePath,
    env,
    envContent,
    version: env.DAOFLOW_VERSION || "unknown",
    domain,
    port,
    scheme
  };
}

export function ensureInstallDirectories(dir: string): { envPath: string; composePath: string } {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "backups"), { recursive: true });
  return getInstallPaths(dir);
}

export function writeInstallFile(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o600 });
}

export async function writeComposeFile(
  runtime: InstallerRuntime,
  composePath: string
): Promise<void> {
  const composeContent = await runtime.fetchComposeYml();
  writeFileSync(composePath, composeContent);
}

export function runComposeCommand(input: {
  runtime: InstallerRuntime;
  dir: string;
  args: string;
  envPath?: string;
  envOverrides?: Record<string, string>;
}): string | Buffer {
  const fileEnv = input.envPath ? parseEnvFile(readFileSync(input.envPath, "utf-8")) : undefined;
  const env =
    fileEnv || input.envOverrides
      ? {
          ...process.env,
          ...(fileEnv ?? {}),
          ...(input.envOverrides ?? {})
        }
      : undefined;

  return input.runtime.exec(`docker compose ${input.args}`, {
    cwd: input.dir,
    stdio: "pipe",
    env
  });
}

export function updateInstalledVersion(envContent: string, targetVersion: string): string {
  if (envContent.includes("DAOFLOW_VERSION=")) {
    return envContent.replace(/DAOFLOW_VERSION=.*/, `DAOFLOW_VERSION=${targetVersion}`);
  }

  return `DAOFLOW_VERSION=${targetVersion}\n${envContent}`;
}

export function updateInstalledPublicUrl(envContent: string, publicUrl: string): string {
  const trimmedUrl = publicUrl.trim();
  if (!trimmedUrl) {
    return envContent;
  }

  if (envContent.includes("BETTER_AUTH_URL=")) {
    return envContent.replace(/BETTER_AUTH_URL=.*/, `BETTER_AUTH_URL=${trimmedUrl}`);
  }

  return `BETTER_AUTH_URL=${trimmedUrl}\n${envContent}`;
}

export function resolveInstallHealthPort(env: Record<string, string>, fallbackPort = 3000): number {
  return parseInt(env.DAOFLOW_PORT || env.PORT || String(fallbackPort), 10);
}

export function buildInstallUrl(input: {
  domain: string;
  scheme: "http" | "https";
  port: number;
}): string {
  const defaultPort = input.scheme === "https" ? 443 : 80;
  return `${input.scheme}://${input.domain}${input.port === defaultPort ? "" : `:${input.port}`}`;
}

export async function waitForInstallHealth(input: {
  runtime: InstallerRuntime;
  port: number;
  attempts?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const attempts = input.attempts ?? 30;
  const intervalMs = input.intervalMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await input.runtime.fetch(`http://127.0.0.1:${input.port}/trpc/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    }

    await input.runtime.sleep(intervalMs);
  }

  return false;
}

export function discoverInstallations(
  exec: InstallerRuntime["exec"] = installerRuntime.exec
): string[] {
  try {
    const output = exec(
      'docker ps --filter "ancestor=*daoflow*" --format "{{.Labels}}" 2>/dev/null || ' +
        'docker ps --format "{{.Image}} {{.Labels}}" 2>/dev/null',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const dirs = new Set<string>();
    for (const line of String(output).split("\n")) {
      if (!line.includes("daoflow")) continue;

      const match = line.match(/com\.docker\.compose\.project\.working_dir=([^,\s]+)/);
      if (match?.[1]) {
        dirs.add(match[1]);
      }
    }

    if (dirs.size === 0) {
      try {
        const psOutput = String(
          exec('docker ps --format "{{.ID}}" --filter "name=daoflow"', {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"]
          })
        ).trim();

        for (const containerId of psOutput.split("\n").filter(Boolean)) {
          if (!/^[a-f0-9]+$/i.test(containerId)) continue;

          try {
            const inspectOutput = String(
              exec(
                `docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' ${containerId}`,
                { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
              )
            ).trim();
            if (inspectOutput && inspectOutput !== "<no value>") {
              dirs.add(inspectOutput);
            }
          } catch {
            // container inspect failed
          }
        }
      } catch {
        // docker ps failed
      }
    }

    return [...dirs];
  } catch {
    return [];
  }
}
