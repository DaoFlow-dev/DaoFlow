/**
 * git-executor.ts — Git clone, checkout, submodule, and LFS operations.
 *
 * Extracted from docker-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: staging directory management, git clone with branch/commit pinning,
 * submodule sync, Git LFS, and repository preparation.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execStreaming, type OnLog } from "./docker-executor";
import type { RepositoryPreparationConfig } from "../repository-preparation";

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

function describeRepositoryPreparation(config: RepositoryPreparationConfig): string[] {
  const required: string[] = [];
  if (config.submodules) {
    required.push("submodules");
  }
  if (config.gitLfs) {
    required.push("Git LFS");
  }
  return required;
}

function formatCommitLabel(commitSha: string): string {
  return commitSha.slice(0, 12);
}

async function checkoutPinnedGitCommit(
  workDir: string,
  commitSha: string,
  onLog: OnLog,
  options: {
    gitConfigPath?: string | null;
  },
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; errorMessage?: string }> {
  const envOverrides = options.gitConfigPath
    ? { GIT_CONFIG_GLOBAL: options.gitConfigPath }
    : undefined;

  onLog({
    stream: "stdout",
    message: `Pinning repository checkout to commit ${formatCommitLabel(commitSha)}`,
    timestamp: new Date()
  });

  const fetch = await execRunner(
    "git",
    ["fetch", "--depth", "1", "origin", commitSha],
    workDir,
    onLog,
    envOverrides
  );
  if (fetch.exitCode !== 0) {
    return {
      exitCode: fetch.exitCode,
      errorMessage: `git fetch failed for commit ${commitSha} with exit code ${fetch.exitCode}`
    };
  }

  const checkout = await execRunner(
    "git",
    ["checkout", "--detach", commitSha],
    workDir,
    onLog,
    envOverrides
  );
  if (checkout.exitCode !== 0) {
    return {
      exitCode: checkout.exitCode,
      errorMessage: `git checkout failed for commit ${commitSha} with exit code ${checkout.exitCode}`
    };
  }

  return { exitCode: 0 };
}

export async function prepareClonedRepository(
  workDir: string,
  onLog: OnLog,
  options: {
    repositoryPreparation?: RepositoryPreparationConfig;
    gitConfigPath?: string | null;
  },
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; errorMessage?: string }> {
  const repositoryPreparation = options.repositoryPreparation ?? {
    submodules: false,
    gitLfs: false
  };
  const required = describeRepositoryPreparation(repositoryPreparation);
  if (required.length === 0) {
    return { exitCode: 0 };
  }

  const envOverrides = options.gitConfigPath
    ? { GIT_CONFIG_GLOBAL: options.gitConfigPath }
    : undefined;

  onLog({
    stream: "stdout",
    message: `Preparing repository checkout: ${required.join(", ")}`,
    timestamp: new Date()
  });

  if (repositoryPreparation.gitLfs) {
    const lfsCheck = await execRunner("git", ["lfs", "version"], workDir, onLog, envOverrides);
    if (lfsCheck.exitCode !== 0) {
      return {
        exitCode: lfsCheck.exitCode,
        errorMessage:
          "Git LFS is required for this deployment source, but git-lfs is not available on the worker."
      };
    }
  }

  if (repositoryPreparation.submodules) {
    onLog({
      stream: "stdout",
      message: "Synchronizing git submodules recursively",
      timestamp: new Date()
    });
    const sync = await execRunner(
      "git",
      ["submodule", "sync", "--recursive"],
      workDir,
      onLog,
      envOverrides
    );
    if (sync.exitCode !== 0) {
      return {
        exitCode: sync.exitCode,
        errorMessage: `git submodule sync failed with exit code ${sync.exitCode}`
      };
    }

    onLog({
      stream: "stdout",
      message: "Updating git submodules recursively",
      timestamp: new Date()
    });
    const update = await execRunner(
      "git",
      ["submodule", "update", "--init", "--recursive", "--depth", "1"],
      workDir,
      onLog,
      envOverrides
    );
    if (update.exitCode !== 0) {
      return {
        exitCode: update.exitCode,
        errorMessage: `git submodule update failed with exit code ${update.exitCode}`
      };
    }
  }

  if (repositoryPreparation.gitLfs) {
    onLog({
      stream: "stdout",
      message: "Pulling Git LFS objects",
      timestamp: new Date()
    });
    const lfsPull = await execRunner("git", ["lfs", "pull"], workDir, onLog, envOverrides);
    if (lfsPull.exitCode !== 0) {
      return {
        exitCode: lfsPull.exitCode,
        errorMessage: `git lfs pull failed with exit code ${lfsPull.exitCode}`
      };
    }

    if (repositoryPreparation.submodules) {
      onLog({
        stream: "stdout",
        message: "Pulling Git LFS objects for submodules",
        timestamp: new Date()
      });
      const submoduleLfsPull = await execRunner(
        "git",
        ["submodule", "foreach", "--recursive", "git lfs pull"],
        workDir,
        onLog,
        envOverrides
      );
      if (submoduleLfsPull.exitCode !== 0) {
        return {
          exitCode: submoduleLfsPull.exitCode,
          errorMessage: `git lfs pull failed for submodules with exit code ${submoduleLfsPull.exitCode}`
        };
      }
    }
  }

  return { exitCode: 0 };
}

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
