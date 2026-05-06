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

function buildPreviewLine(run: typeof developmentTaskRuns.$inferSelect) {
  if (run.previewUrl) {
    return `Preview: ${run.previewUrl}`;
  }

  const preview = readMetadataRecord(readMetadataRecord(run.metadata).preview);
  const status = preview.status;
  if (status === "failed" || status === "skipped") {
    const message = typeof preview.message === "string" ? ` (${preview.message})` : "";
    return `Preview: ${status}${message}`;
  }

  return "Preview: pending";
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
  reviewRequestLabel?: string;
  openedSummary?: string;
}) {
  const reviewRequestLabel = input.reviewRequestLabel ?? "Pull request";
  return [
    input.openedSummary ?? "DaoFlow opened a pull request.",
    "",
    "Status: waiting_review",
    `${reviewRequestLabel}: ${input.run.pullRequestUrl ?? "pending"}`,
    buildPreviewLine(input.run),
    `Run: ${buildDevelopmentTaskRunUrl(input.task.id)}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.task.repoFullName}#${input.task.issueNumber}`
  ].join("\n");
}

export function buildDevelopmentTaskFailedComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  projectName: string;
}) {
  return [
    "DaoFlow stopped work on this task.",
    "",
    "Status: failed",
    `Failure: ${input.run.failureCategory ?? "unknown"}`,
    `Message: ${input.run.failureMessage ?? "Development task failed."}`,
    `Run: ${buildDevelopmentTaskRunUrl(input.task.id)}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.task.repoFullName}#${input.task.issueNumber}`
  ].join("\n");
}
