import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { execStreaming, type OnLog } from "./docker-exec-shared";
import { prepareClonedRepository } from "./git-repository-preparation";
import { requireManagedSshGitCredential, strictGitSshCommand } from "./git-ssh-trust";
import { resolveCheckoutSpec } from "./checkout-source";
import type { ConfigSnapshot } from "./step-management";
import { readRepositoryPreparationConfig } from "../repository-preparation";

type ExecRunner = typeof execStreaming;

export interface DevelopmentTaskRepositoryCheckoutResult {
  status: "ok" | "failed" | "skipped";
  branch?: string;
  displayLabel?: string;
  repoPath: string;
  errorMessage?: string;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeGitConfigFileName(runId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error("Run id must be a safe path segment.");
  }

  return `${runId}.gitconfig`;
}

function safeGitSshKeyFileName(runId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error("Run id must be a safe path segment.");
  }

  return `${runId}.git_ssh_key`;
}

async function writeGitConfigFile(
  artifactsPath: string,
  runId: string,
  gitConfig: Array<{ key: string; value: string }>
) {
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
  const configPath = path.join(artifactsPath, safeGitConfigFileName(runId));

  await writeFile(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  return configPath;
}

async function writeGitSshKeyFile(artifactsPath: string, runId: string, privateKey?: string) {
  if (!privateKey?.trim()) {
    return null;
  }

  const keyPath = path.join(artifactsPath, safeGitSshKeyFileName(runId));
  await writeFile(keyPath, `${privateKey.trim()}\n`, { mode: 0o600 });
  await chmod(keyPath, 0o600);
  return keyPath;
}

export function buildDevelopmentTaskCheckoutConfig(input: {
  task: typeof developmentTasks.$inferSelect;
  project: typeof projects.$inferSelect;
}): ConfigSnapshot {
  const projectConfig = asRecord(input.project.config);

  return {
    projectId: input.project.id,
    repoUrl: input.project.repoUrl ?? undefined,
    repoFullName: input.task.repoFullName ?? input.project.repoFullName ?? undefined,
    gitProviderId: input.project.gitProviderId ?? undefined,
    gitInstallationId:
      input.task.providerInstallationId ?? input.project.gitInstallationId ?? undefined,
    branch: input.task.baseBranch ?? input.project.defaultBranch ?? "main",
    repositoryPreparation: readRepositoryPreparationConfig(projectConfig.repositoryPreparation)
  };
}

export async function checkoutDevelopmentTaskRepository(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  repoPath: string;
  artifactsPath: string;
  onLog: OnLog;
  execRunner?: ExecRunner;
}): Promise<DevelopmentTaskRepositoryCheckoutResult> {
  const checkout = await resolveCheckoutSpec(
    buildDevelopmentTaskCheckoutConfig({ task: input.task, project: input.project })
  );

  if (!checkout) {
    return {
      status: "skipped",
      repoPath: input.repoPath,
      errorMessage: "No repository checkout source is configured for this project."
    };
  }

  requireManagedSshGitCredential(checkout.repoUrl, checkout.sshPrivateKey);

  const execRunner = input.execRunner ?? execStreaming;
  const gitConfigPath = await writeGitConfigFile(
    input.artifactsPath,
    input.run.id,
    checkout.gitConfig
  );
  const gitSshKeyPath = await writeGitSshKeyFile(
    input.artifactsPath,
    input.run.id,
    checkout.sshPrivateKey
  );
  const envOverrides = {
    ...(gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : {}),
    ...(gitSshKeyPath
      ? {
          GIT_SSH_COMMAND: strictGitSshCommand(gitSshKeyPath)
        }
      : {})
  };

  try {
    input.onLog({
      stream: "stdout",
      message: `Checking out ${checkout.displayLabel} (branch: ${checkout.branch})`,
      timestamp: new Date()
    });

    const clone = await execRunner(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        checkout.branch,
        "--single-branch",
        "--",
        checkout.repoUrl,
        "."
      ],
      input.repoPath,
      input.onLog,
      Object.keys(envOverrides).length > 0 ? envOverrides : undefined
    );
    if (clone.exitCode !== 0) {
      return {
        status: "failed",
        repoPath: input.repoPath,
        branch: checkout.branch,
        displayLabel: checkout.displayLabel,
        errorMessage: `git clone failed with exit code ${clone.exitCode}`
      };
    }

    const preparation = await prepareClonedRepository(
      input.repoPath,
      input.onLog,
      {
        repositoryPreparation: checkout.repositoryPreparation,
        gitConfigPath
      },
      execRunner
    );
    if (preparation.exitCode !== 0) {
      return {
        status: "failed",
        repoPath: input.repoPath,
        branch: checkout.branch,
        displayLabel: checkout.displayLabel,
        errorMessage: preparation.errorMessage
      };
    }

    return {
      status: "ok",
      repoPath: input.repoPath,
      branch: checkout.branch,
      displayLabel: checkout.displayLabel
    };
  } finally {
    if (gitConfigPath) {
      await rm(gitConfigPath, { force: true });
    }
    if (gitSshKeyPath) {
      await rm(gitSshKeyPath, { force: true });
    }
  }
}
