import {
  DEFAULT_CODEX_CONFIG_TEMPLATE,
  DEFAULT_CODEX_HOME_PATH
} from "../db/services/default-development-runner";
import { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function promptScalar(value: string | number | null | undefined) {
  return String(value ?? "unknown")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safePathSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be a safe path segment.`);
  }

  return value;
}

function normalizedWorkspaceRoot(input?: string) {
  const workspaceRoot = (input ?? "/runner/work").replace(/\/$/, "");

  if (!workspaceRoot.startsWith("/") || workspaceRoot.split("/").includes("..")) {
    throw new Error("Workspace root must be an absolute safe path.");
  }

  return workspaceRoot;
}

function buildWorkspacePath(workspaceRoot: string, runId: string, child: string) {
  return `${normalizedWorkspaceRoot(workspaceRoot)}/${safePathSegment(runId, "Run id")}/${child}`;
}

export function buildDevelopmentTaskPrompt(input: {
  task: typeof developmentTasks.$inferSelect;
  validationCommands: string[];
}) {
  const validation =
    input.validationCommands.length > 0
      ? input.validationCommands.map((command) => `- ${promptScalar(command)}`).join("\n")
      : "- No validation commands configured; propose appropriate checks, inspect manually, and explain residual risk.";
  const requestedBy = promptScalar(
    input.task.requestedByExternalUser ?? input.task.issueAuthor ?? "unknown"
  );

  return [
    "You are working on a DaoFlow-managed development task.",
    "",
    "Task:",
    `- Repository: ${promptScalar(input.task.repoFullName)}`,
    `- Base branch: ${promptScalar(input.task.baseBranch)}`,
    `- Issue: #${promptScalar(input.task.issueNumber)} ${promptScalar(input.task.issueTitle)}`,
    `- Issue URL: ${promptScalar(input.task.issueUrl)}`,
    `- Requested by: ${requestedBy}`,
    "",
    "Safety rules:",
    "- Do not expose secrets.",
    "- Do not force-push the default branch.",
    "- Do not merge the pull request.",
    "- Do not deploy production.",
    "- Keep changes scoped to the issue.",
    "",
    "Validation commands:",
    validation,
    "",
    "Required final response:",
    "- Summary",
    "- Files changed",
    "- Validation commands run",
    "- Validation result",
    "- Known risks",
    "- Pull request body draft"
  ].join("\n");
}

export function buildDevelopmentTaskCodexPlan(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  workspaceRoot?: string;
}) {
  const metadata = readRecord(input.run.metadata);
  const validationCommands = readStringArray(metadata.validationCommands);
  const configToml =
    typeof metadata.codexConfigTemplate === "string" && metadata.codexConfigTemplate.trim()
      ? metadata.codexConfigTemplate
      : DEFAULT_CODEX_CONFIG_TEMPLATE;
  const codexProfile = input.run.codexProfile ?? "daoflow";
  const codexHomePath = buildWorkspacePath(
    input.workspaceRoot ?? "/runner/work",
    input.run.id,
    "home/.codex"
  );
  const repoPath = buildWorkspacePath(input.workspaceRoot ?? "/runner/work", input.run.id, "repo");
  const prompt = buildDevelopmentTaskPrompt({
    task: input.task,
    validationCommands
  });

  return {
    codexHomePath,
    configPath: `${codexHomePath}/config.toml`,
    repoPath,
    artifactsPath: buildWorkspacePath(
      input.workspaceRoot ?? "/runner/work",
      input.run.id,
      "artifacts"
    ),
    logsPath: buildWorkspacePath(input.workspaceRoot ?? "/runner/work", input.run.id, "logs"),
    defaultCodexHomePath: DEFAULT_CODEX_HOME_PATH,
    configToml,
    prompt,
    command: "codex",
    args: ["exec", "--json", "--profile", codexProfile, "--cd", repoPath, prompt],
    env: {
      CODEX_HOME: codexHomePath,
      DAOFLOW_TASK_ID: input.task.id,
      DAOFLOW_RUN_ID: input.run.id
    }
  };
}

export type DevelopmentTaskCodexPlan = ReturnType<typeof buildDevelopmentTaskCodexPlan>;
