import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import type { projects } from "../db/schema/projects";
import type { DevelopmentTaskPreviewResult } from "./development-task-preview";
import type { DevelopmentTaskPullRequestResult } from "./development-task-pull-request";

type HandoffAuditOutcome = "success" | "failure" | "skipped";

function previewAuditOutcome(status: DevelopmentTaskPreviewResult["status"]): HandoffAuditOutcome {
  if (status === "queued") return "success";
  if (status === "skipped") return "skipped";
  return "failure";
}

function baseMetadata(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project?: typeof projects.$inferSelect;
}) {
  return {
    resourceType: "development_task",
    resourceId: input.task.id,
    runId: input.run.id,
    projectId: input.task.projectId,
    teamId: input.project?.teamId ?? null,
    providerType: input.task.providerType,
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber
  };
}

async function recordHandoffAuditEntry(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project?: typeof projects.$inferSelect;
  action: string;
  inputSummary: string;
  outcome: HandoffAuditOutcome;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: input.run.runnerId ?? "development-task-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "agent",
    organizationId: input.project?.teamId ?? null,
    targetResource: `development_task/${input.task.id}`,
    action: input.action,
    inputSummary: input.inputSummary,
    permissionScope: "deploy:start",
    outcome: input.outcome,
    metadata: {
      ...baseMetadata(input),
      ...input.metadata
    }
  });
}

export async function recordPullRequestHandoffAudit(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  pullRequest: DevelopmentTaskPullRequestResult;
}) {
  await recordHandoffAuditEntry({
    task: input.task,
    run: input.run,
    project: input.project,
    action: "development_task.pull_request.open",
    inputSummary: `Opened pull request for ${input.task.repoFullName}#${input.task.issueNumber}`,
    outcome: input.pullRequest.status === "ok" ? "success" : "failure",
    metadata: {
      branchName: input.pullRequest.branchName ?? null,
      commitSha: input.pullRequest.commitSha ?? null,
      pullRequestNumber: input.pullRequest.pullRequestNumber ?? null,
      pullRequestUrl: input.pullRequest.pullRequestUrl ?? null,
      errorMessage: input.pullRequest.errorMessage ?? null
    }
  });
}

export async function recordMergeRequestHandoffAudit(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  mergeRequest: DevelopmentTaskPullRequestResult;
}) {
  await recordHandoffAuditEntry({
    task: input.task,
    run: input.run,
    project: input.project,
    action: "development_task.merge_request.open",
    inputSummary: `Opened merge request for ${input.task.repoFullName}#${input.task.issueNumber}`,
    outcome: input.mergeRequest.status === "ok" ? "success" : "failure",
    metadata: {
      branchName: input.mergeRequest.branchName ?? null,
      commitSha: input.mergeRequest.commitSha ?? null,
      mergeRequestNumber: input.mergeRequest.pullRequestNumber ?? null,
      mergeRequestUrl: input.mergeRequest.pullRequestUrl ?? null,
      errorMessage: input.mergeRequest.errorMessage ?? null
    }
  });
}

export async function recordPreviewHandoffAudit(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  preview: DevelopmentTaskPreviewResult;
}) {
  const actionByStatus = {
    queued: "development_task.preview.queue",
    skipped: "development_task.preview.skip",
    failed: "development_task.preview.fail"
  } satisfies Record<DevelopmentTaskPreviewResult["status"], string>;

  await recordHandoffAuditEntry({
    task: input.task,
    run: input.run,
    project: input.project,
    action: actionByStatus[input.preview.status],
    inputSummary: `Recorded preview result for ${input.task.repoFullName}#${input.task.issueNumber}`,
    outcome: previewAuditOutcome(input.preview.status),
    metadata: {
      previewDeploymentId: input.preview.previewDeploymentId ?? null,
      previewUrl: input.preview.previewUrl ?? null,
      deploymentCount: input.preview.deployments.length,
      message: input.preview.message ?? null,
      deployments: input.preview.deployments
    }
  });
}
