import { chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { execStreaming, type OnLog } from "./docker-exec-shared";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { buildDevelopmentTaskCheckoutConfig } from "./development-task-repository-checkout";
import { resolveCheckoutSpec } from "./checkout-source";
import {
  buildDevelopmentTaskBranchName,
  createGitHubDevelopmentTaskPullRequest
} from "./development-task-pull-request-github";

type ExecRunner = typeof execStreaming;

export interface DevelopmentTaskPullRequestResult {
  status: "ok" | "failed";
  branchName?: string;
  commitSha?: string;
  changedFiles?: Array<{ path: string; status: string }>;
  diffStat?: string;
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

function parseChangedFiles(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split("\t");
      return {
        status: status ?? "unknown",
        path: pathParts.join(" -> ")
      };
    })
    .filter((file) => file.path);
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
  const logPath = `${input.workspace.logsPath}/pull-request.jsonl`;
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

  const gitConfigPath = await writeGitConfigFile(
    input.workspace.artifactsPath,
    input.run.id,
    checkout.gitConfig
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
        status: "failed",
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
    const pullRequest = await createGitHubDevelopmentTaskPullRequest({
      provider: input.provider,
      installation: input.installation,
      task: input.task,
      run: input.run,
      branchName,
      validationStatus: input.validationStatus
    });

    return {
      status: "ok",
      branchName,
      commitSha,
      changedFiles: parseChangedFiles(changedFilesOutput),
      diffStat,
      logPath,
      ...pullRequest
    };
  } catch (err) {
    return {
      status: "failed",
      branchName,
      logPath,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  } finally {
    if (gitConfigPath) {
      await rm(gitConfigPath, { force: true });
    }
  }
}
