import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wrapperPath = resolve(import.meta.dir, "run-e2e-real-infra.sh");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFakeCommand(directory: string, name: string, script: string): string {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

function runHarness(environment: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync("sh", [wrapperPath], {
    encoding: "utf8",
    env: { ...process.env, ...environment }
  });
}

test("rejects malformed run tokens before installing cleanup", () => {
  const directory = mkdtempSync(join(tmpdir(), "daoflow-real-infra-token-"));
  temporaryDirectories.push(directory);
  const removalLog = join(directory, "removals");
  createFakeCommand(directory, "rm", 'printf "%s\\n" "$@" >> "$RM_LOG"');

  const result = runHarness({
    DAOFLOW_REAL_INFRA: "1",
    DAOFLOW_REAL_INFRA_RUN_TOKEN: "riabc123def456/../outside",
    PATH: `${directory}:${process.env.PATH}`,
    RM_LOG: removalLog
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("must match ^ri[a-z0-9]{12,40}$");
  expect(existsSync(removalLog)).toBe(false);
});

test("cleans only the immutable token-owned local state path", () => {
  const directory = mkdtempSync(join(tmpdir(), "daoflow-real-infra-cleanup-"));
  temporaryDirectories.push(directory);
  const removalLog = join(directory, "removals");
  createFakeCommand(directory, "bun", "exit 1");
  createFakeCommand(directory, "rm", 'printf "%s\\n" "$@" >> "$RM_LOG"');

  const token = "riabc123def456";
  const result = runHarness({
    DAOFLOW_REAL_INFRA: "1",
    DAOFLOW_REAL_INFRA_RUN_TOKEN: token,
    DAOFLOW_REAL_INFRA_LOCAL_STATE_ROOT: "/tmp/should-not-be-removed",
    PATH: `${directory}:${process.env.PATH}`,
    RM_LOG: removalLog
  });

  expect(result.status).toBe(1);
  expect(readFileSync(removalLog, "utf8").trim().split("\n")).toEqual([
    "-rf",
    "--",
    `/tmp/dfri/${token}`
  ]);
});
