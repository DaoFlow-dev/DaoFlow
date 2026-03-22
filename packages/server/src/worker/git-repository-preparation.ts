import { execStreaming, type OnLog } from "./docker-exec-shared";
import type { RepositoryPreparationConfig } from "../repository-preparation";

type ExecRunner = typeof execStreaming;

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

export async function checkoutPinnedGitCommit(
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
