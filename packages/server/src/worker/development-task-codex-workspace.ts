import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";

export interface PreparedDevelopmentTaskCodexWorkspace {
  codexHomePath: string;
  configPath: string;
  authJsonPath: string;
  repoPath: string;
  artifactsPath: string;
  logsPath: string;
  promptPath: string;
  runPlanPath: string;
}

function withTrailingNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function joinPlanPath(parent: string, child: string) {
  const nextPath = path.posix.join(parent, child);
  const relative = path.posix.relative(parent, nextPath);

  if (relative.startsWith("..") || path.posix.isAbsolute(relative)) {
    throw new Error("Workspace artifact path must stay inside the planned directory.");
  }

  return nextPath;
}

function redactedPlan(plan: DevelopmentTaskCodexPlan, promptPath: string) {
  return {
    command: plan.command,
    args: plan.args.map((arg) => (arg === plan.prompt ? `@${promptPath}` : arg)),
    env: {
      CODEX_HOME: plan.env.CODEX_HOME,
      DAOFLOW_TASK_ID: plan.env.DAOFLOW_TASK_ID,
      DAOFLOW_RUN_ID: plan.env.DAOFLOW_RUN_ID
    },
    paths: {
      codexHomePath: plan.codexHomePath,
      configPath: plan.configPath,
      authJsonPath: plan.authJsonPath,
      repoPath: plan.repoPath,
      artifactsPath: plan.artifactsPath,
      logsPath: plan.logsPath,
      promptPath
    },
    codexAuthMode: plan.codexAuthMode,
    codexAuthJsonEnvKey:
      plan.codexAuthMode === "chatgpt_auth_json" ? plan.codexAuthJsonEnvKey : undefined
  };
}

function readAuthJson(plan: DevelopmentTaskCodexPlan) {
  if (plan.codexAuthMode !== "chatgpt_auth_json") {
    return null;
  }

  const rawAuthJson = process.env[plan.codexAuthJsonEnvKey];
  if (!rawAuthJson?.trim()) {
    throw new Error(`${plan.codexAuthJsonEnvKey} is required for chatgpt_auth_json Codex auth.`);
  }

  try {
    JSON.parse(rawAuthJson) as unknown;
  } catch {
    throw new Error(`${plan.codexAuthJsonEnvKey} must contain valid Codex auth JSON.`);
  }

  return rawAuthJson;
}

export async function prepareDevelopmentTaskCodexWorkspace(
  plan: DevelopmentTaskCodexPlan
): Promise<PreparedDevelopmentTaskCodexWorkspace> {
  const promptPath = joinPlanPath(plan.artifactsPath, "task-prompt.md");
  const runPlanPath = joinPlanPath(plan.artifactsPath, "codex-run-plan.json");

  await Promise.all([
    mkdir(plan.codexHomePath, { recursive: true }),
    mkdir(plan.repoPath, { recursive: true }),
    mkdir(plan.artifactsPath, { recursive: true }),
    mkdir(plan.logsPath, { recursive: true })
  ]);

  await writeFile(plan.configPath, withTrailingNewline(plan.configToml), { mode: 0o600 });
  await chmod(plan.configPath, 0o600);
  const authJson = readAuthJson(plan);
  if (authJson) {
    await writeFile(plan.authJsonPath, withTrailingNewline(authJson), { mode: 0o600 });
    await chmod(plan.authJsonPath, 0o600);
  }
  await writeFile(promptPath, withTrailingNewline(plan.prompt), { mode: 0o600 });
  await chmod(promptPath, 0o600);
  await writeFile(runPlanPath, `${JSON.stringify(redactedPlan(plan, promptPath), null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(runPlanPath, 0o600);

  return {
    codexHomePath: plan.codexHomePath,
    configPath: plan.configPath,
    authJsonPath: plan.authJsonPath,
    repoPath: plan.repoPath,
    artifactsPath: plan.artifactsPath,
    logsPath: plan.logsPath,
    promptPath,
    runPlanPath
  };
}
