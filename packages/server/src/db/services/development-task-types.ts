import type { AppRole } from "@daoflow/shared";
import {
  DEVELOPMENT_TASK_RUN_STATUSES,
  DEVELOPMENT_TASK_STATUSES
} from "../schema/development-tasks";

export type DevelopmentTaskStatus = (typeof DEVELOPMENT_TASK_STATUSES)[number];
export type DevelopmentTaskRunStatus = (typeof DEVELOPMENT_TASK_RUN_STATUSES)[number];
export type DevelopmentTaskProviderType = "github" | "gitlab";

export const ACTIVE_TASK_STATUSES: DevelopmentTaskStatus[] = [
  "queued",
  "running",
  "waiting_review",
  "blocked"
];

export interface DevelopmentTaskActor {
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | "agent" | null;
  requestedByExternalUser?: string | null;
}

export interface QueueDevelopmentTaskInput extends DevelopmentTaskActor {
  providerType: DevelopmentTaskProviderType;
  providerInstallationId?: string | null;
  projectId: string;
  repoFullName: string;
  externalIssueId: string;
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueAuthor?: string | null;
  baseBranch?: string | null;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateDevelopmentTaskRunInput {
  taskId: string;
  runnerProfileId?: string | null;
  sandboxProvider?: string | null;
  codexProfile?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordDevelopmentTaskEventInput {
  taskId: string;
  runId?: string | null;
  kind: string;
  summary: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordDevelopmentTaskCommentInput {
  taskId: string;
  runId?: string | null;
  providerType: DevelopmentTaskProviderType;
  externalCommentId: string;
  commentKind: string;
  lastBodyHash?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateDevelopmentTaskRunInput {
  runId: string;
  status: DevelopmentTaskRunStatus;
  runnerId?: string | null;
  sandboxId?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  previewDeploymentId?: string | null;
  previewUrl?: string | null;
  failureCategory?: string | null;
  failureMessage?: string | null;
  metadata?: Record<string, unknown>;
}
