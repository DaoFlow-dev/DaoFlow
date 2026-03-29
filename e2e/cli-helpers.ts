import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_BINARY_PATH = resolve(process.cwd(), "packages/cli/dist/daoflow");

export function createCliHomeDir(): string {
  return mkdtempSync(join(tmpdir(), "daoflow-cli-e2e-"));
}

export function removeCliHomeDir(homeDir: string): void {
  rmSync(homeDir, { recursive: true, force: true });
}

export function getCliBinaryPath(): string {
  if (!existsSync(CLI_BINARY_PATH)) {
    throw new Error(`Compiled CLI binary not found at ${CLI_BINARY_PATH}`);
  }

  return CLI_BINARY_PATH;
}

export function getCliConfigPath(homeDir: string): string {
  return join(homeDir, ".daoflow", "config.json");
}

export function getCliConfigMode(homeDir: string): number {
  return statSync(getCliConfigPath(homeDir)).mode & 0o777;
}

export function runCliCommand(input: {
  homeDir: string;
  args: string[];
  expectedExitCode?: number;
}) {
  const result = spawnSync(getCliBinaryPath(), input.args, {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: input.homeDir,
      NO_COLOR: "1"
    }
  });

  if (result.error) {
    throw result.error;
  }

  const expectedExitCode = input.expectedExitCode ?? 0;
  if (result.status !== expectedExitCode) {
    throw new Error(
      [
        `CLI exited with ${String(result.status)} instead of ${String(expectedExitCode)}.`,
        `Command: ${getCliBinaryPath()} ${input.args.join(" ")}`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`
      ].join("\n")
    );
  }

  return result;
}

export function runCliJson<T>(input: {
  homeDir: string;
  args: string[];
  expectedExitCode?: number;
}): T {
  const result = runCliCommand(input);
  const stdout = result.stdout.trim();

  if (!stdout) {
    throw new Error(`CLI command produced no stdout: ${input.args.join(" ")}`);
  }

  return JSON.parse(stdout) as T;
}
