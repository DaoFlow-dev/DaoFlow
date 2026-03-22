/**
 * git-executor.ts — Git clone, checkout, submodule, and LFS operations.
 *
 * Extracted from docker-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: staging directory management and git clone orchestration.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execStreaming, type OnLog } from "./docker-exec-shared";
import type { RepositoryPreparationConfig } from "../repository-preparation";
import { checkoutPinnedGitCommit, prepareClonedRepository } from "./git-repository-preparation";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";

type ExecRunner = typeof execStreaming;

export interface GitCloneOptions {
  displayLabel?: string;
  gitConfig?: Array<{ key: string; value: string }>;
  repositoryPreparation?: RepositoryPreparationConfig;
  commitSha?: string;
}

/**
 * Ensure the staging directory for a deployment exists.
 */
export function ensureStagingDir(deploymentId: string): string {
  const dir = join(STAGING_DIR, deploymentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getStagingArchivePath(deploymentId: string): string {
  return join(STAGING_DIR, `${deploymentId}.tar.gz`);
}

function writeGitConfigFile(
  deploymentId: string,
  gitConfig: Array<{ key: string; value: string }>
): string | null {
  if (gitConfig.length === 0) {
    return null;
  }

  const lines = gitConfig.flatMap(({ key, value }) => {
    const [section, ...rest] = key.split(".");
    const configKey = rest.join(".");
    if (!section || !configKey) {
      throw new Error(`Unsupported git config key: ${key}`);
    }

    return [`[${section}]`, `\t${configKey} = ${value}`];
  });

  const configPath = join(STAGING_DIR, `${deploymentId}.gitconfig`);
  writeFileSync(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return configPath;
}

export { prepareClonedRepository } from "./git-repository-preparation";

/**
 * Clean up staging directory after deployment.
 */
export function cleanupStagingDir(deploymentId: string): void {
  const dir = join(STAGING_DIR, deploymentId);
  const archivePath = getStagingArchivePath(deploymentId);
  const gitConfigPath = join(STAGING_DIR, `${deploymentId}.gitconfig`);
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (existsSync(archivePath)) {
      rmSync(archivePath, { force: true });
    }
    if (existsSync(gitConfigPath)) {
      rmSync(gitConfigPath, { force: true });
    }
  } catch {
    /* best effort cleanup */
  }
}

/**
 * Clone a git repository into the staging directory.
 */
export async function gitClone(
  repoUrl: string,
  branch: string,
  deploymentId: string,
  onLog: OnLog,
  options?: GitCloneOptions,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; workDir: string; errorMessage?: string }> {
  const workDir = ensureStagingDir(deploymentId);
  const displayLabel = options?.displayLabel ?? repoUrl;
  const gitConfigPath = writeGitConfigFile(deploymentId, options?.gitConfig ?? []);
  const commitSha = options?.commitSha?.trim();

  onLog({
    stream: "stdout",
    message: `Cloning ${displayLabel} (branch: ${branch}) into ${workDir}`,
    timestamp: new Date()
  });

  const result = await execRunner(
    "git",
    ["clone", "--depth", "1", "--branch", branch, "--single-branch", "--", repoUrl, "."],
    workDir,
    onLog,
    gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : undefined
  );

  if (result.exitCode !== 0) {
    return {
      exitCode: result.exitCode,
      workDir,
      errorMessage: `git clone failed with exit code ${result.exitCode}`
    };
  }

  if (commitSha) {
    const pinnedCheckout = await checkoutPinnedGitCommit(
      workDir,
      commitSha,
      onLog,
      { gitConfigPath },
      execRunner
    );
    if (pinnedCheckout.exitCode !== 0) {
      return {
        exitCode: pinnedCheckout.exitCode,
        workDir,
        errorMessage: pinnedCheckout.errorMessage
      };
    }
  }

  const preparation = await prepareClonedRepository(
    workDir,
    onLog,
    {
      repositoryPreparation: options?.repositoryPreparation,
      gitConfigPath
    },
    execRunner
  );

  return {
    exitCode: preparation.exitCode,
    workDir,
    errorMessage: preparation.errorMessage
  };
}
