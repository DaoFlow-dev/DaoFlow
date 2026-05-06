import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function resolveAppBaseUrl() {
  return trimTrailingSlash(
    process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  );
}

function buildDevelopmentTaskRunUrl(taskId: string) {
  return `${resolveAppBaseUrl()}/development-tasks/${taskId}`;
}

function readMetadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildDevelopmentTaskQueuedComment(input: {
  taskId: string;
  repoFullName: string;
  issueNumber: number;
  projectName: string;
}) {
  const runUrl = buildDevelopmentTaskRunUrl(input.taskId);
  return [
    "DaoFlow accepted this task.",
    "",
    "Status: queued",
    `Run: ${runUrl}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.repoFullName}#${input.issueNumber}`
  ].join("\n");
}

export function buildDevelopmentTaskRunningComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  projectName: string;
}) {
  const metadata = readMetadataRecord(input.run.metadata);
  const runner =
    typeof metadata.runnerLabel === "string"
      ? metadata.runnerLabel
      : (input.run.runnerId ?? "development-task-worker");
  const startedAt = input.run.startedAt?.toISOString() ?? new Date().toISOString();
  return [
    "DaoFlow started work.",
    "",
    "Status: running",
    `Runner: ${runner}`,
    `Started: ${startedAt}`,
    `Run: ${buildDevelopmentTaskRunUrl(input.task.id)}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.task.repoFullName}#${input.task.issueNumber}`
  ].join("\n");
}

export function buildDevelopmentTaskReadyForReviewComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  projectName: string;
}) {
  const previewUrl = input.run.previewUrl ?? "pending";
  return [
    "DaoFlow opened a pull request.",
    "",
    "Status: waiting_review",
    `Pull request: ${input.run.pullRequestUrl ?? "pending"}`,
    `Preview: ${previewUrl}`,
    `Run: ${buildDevelopmentTaskRunUrl(input.task.id)}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.task.repoFullName}#${input.task.issueNumber}`
  ].join("\n");
}
