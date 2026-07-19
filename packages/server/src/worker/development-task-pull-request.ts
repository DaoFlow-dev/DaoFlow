import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { execStreaming, type OnLog } from "./docker-exec-shared";
import { appendGitProviderCaConfig, withGitProviderCaFile } from "./git-ca-file";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { buildDevelopmentTaskCheckoutConfig } from "./development-task-repository-checkout";
import { resolveCheckoutSpec } from "./checkout-source";
import {
  buildDevelopmentTaskBranchName,
  createGitHubDevelopmentTaskPullRequest
} from "./development-task-pull-request-github";
import { createGitLabDevelopmentTaskMergeRequest } from "./development-task-merge-request-gitlab";
import {
  parseDevelopmentTaskChangedFiles,
  writeDevelopmentTaskReviewArtifacts,
  type DevelopmentTaskChangedFile
} from "./development-task-review-artifacts";

type ExecRunner = typeof execStreaming;

export interface DevelopmentTaskPullRequestResult {
  status: "ok" | "failed";
  branchName?: string;
  commitSha?: string;
  changedFiles?: DevelopmentTaskChangedFile[];
  diffStat?: string;
  reviewArtifacts?: { diffStatPath: string; changedFilesPath: string };
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  logPath: string;
  errorMessage?: string;
}

function safeGitConfigFileName(runId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error("Run id must be a safe path segment.");
  }

  return `${runId}.pr.gitconfig`;
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

async function runGit(input: {
  execRunner: ExecRunner;
  repoPath: string;
  args: string[];
  onLog: OnLog;
  envOverrides?: Record<string, string>;
}) {
  const result = await input.execRunner(
    "git",
    input.args,
    input.repoPath,
    input.onLog,
    input.envOverrides
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ${input.args[0] ?? "command"} failed with exit code ${result.exitCode}`);
  }
}

async function captureGit(input: {
  execRunner: ExecRunner;
  repoPath: string;
  args: string[];
  onLog: OnLog;
  envOverrides?: Record<string, string>;
}) {
  const lines: string[] = [];
  await runGit({
    ...input,
    onLog: (line) => {
      input.onLog(line);
      if (line.stream === "stdout") {
        lines.push(line.message);
      }
    }
  });
  return lines.join("\n").trim();
}

export async function openGitHubDevelopmentTaskPullRequest(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  validationStatus?: string;
  onLog: OnLog;
  execRunner?: ExecRunner;
}): Promise<DevelopmentTaskPullRequestResult> {
  const execRunner = input.execRunner ?? execStreaming;
  const logName = input.provider.type === "gitlab" ? "merge-request" : "pull-request";
  const logPath = `${input.workspace.logsPath}/${logName}.jsonl`;
  const branchName = buildDevelopmentTaskBranchName(input.task, input.run.id);
  const checkout = await resolveCheckoutSpec(
    buildDevelopmentTaskCheckoutConfig({ task: input.task, project: input.project })
  );

  if (!checkout) {
    return {
      status: "failed",
      branchName,
      logPath,
      errorMessage: "No repository checkout source is configured for this project."
    };
  }

  try {
    return await withGitProviderCaFile(
      checkout.repoUrl,
      checkout.caCertificatePem,
      async (caFilePath) => {
        const gitConfigPath = await writeGitConfigFile(
          input.workspace.artifactsPath,
          input.run.id,
          appendGitProviderCaConfig(checkout.gitConfig, caFilePath)
        );
        const envOverrides = gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : undefined;

        try {
          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["checkout", "-B", branchName],
            onLog: input.onLog,
            envOverrides
          });
          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["config", "user.name", "DaoFlow"],
            onLog: input.onLog,
            envOverrides
          });
          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["config", "user.email", "daoflow-bot@daoflow.local"],
            onLog: input.onLog,
            envOverrides
          });
          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["add", "-A"],
            onLog: input.onLog,
            envOverrides
          });

          const diff = await execRunner(
            "git",
            ["diff", "--cached", "--quiet"],
            input.workspace.repoPath,
            input.onLog,
            envOverrides
          );
          if (diff.exitCode === 0) {
            return {
              status: "failed" as const,
              branchName,
              logPath,
              errorMessage: "Codex finished without file changes to commit."
            };
          }

          const [diffStat, changedFilesOutput] = await Promise.all([
            captureGit({
              execRunner,
              repoPath: input.workspace.repoPath,
              args: ["diff", "--cached", "--stat"],
              onLog: input.onLog,
              envOverrides
            }),
            captureGit({
              execRunner,
              repoPath: input.workspace.repoPath,
              args: ["diff", "--cached", "--name-status"],
              onLog: input.onLog,
              envOverrides
            })
          ]);
          const changedFiles = parseDevelopmentTaskChangedFiles(changedFilesOutput);
          const reviewArtifacts = await writeDevelopmentTaskReviewArtifacts({
            artifactsPath: input.workspace.artifactsPath,
            diffStat,
            changedFiles
          });

          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["commit", "-m", `chore: address development task #${input.task.issueNumber}`],
            onLog: input.onLog,
            envOverrides
          });
          const commitSha = await captureGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["rev-parse", "HEAD"],
            onLog: input.onLog,
            envOverrides
          });
          await runGit({
            execRunner,
            repoPath: input.workspace.repoPath,
            args: ["push", "--set-upstream", "origin", `HEAD:refs/heads/${branchName}`],
            onLog: input.onLog,
            envOverrides
          });
          const pullRequest =
            input.provider.type === "gitlab"
              ? await createGitLabDevelopmentTaskMergeRequest({
                  provider: input.provider,
                  installation: input.installation,
                  task: input.task,
                  run: input.run,
                  branchName,
                  validationStatus: input.validationStatus
                })
              : await createGitHubDevelopmentTaskPullRequest({
                  provider: input.provider,
                  installation: input.installation,
                  task: input.task,
                  run: input.run,
                  branchName,
                  validationStatus: input.validationStatus
                });

          return {
            status: "ok" as const,
            branchName,
            commitSha,
            changedFiles,
            diffStat,
            reviewArtifacts,
            logPath,
            ...pullRequest
          };
        } finally {
          if (gitConfigPath) {
            await rm(gitConfigPath, { force: true });
          }
        }
      }
    );
  } catch (err) {
    return {
      status: "failed",
      branchName,
      logPath,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  }
}
