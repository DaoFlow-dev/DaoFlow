import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";

export interface WebhookCommitChangeSet {
  added?: string[];
  modified?: string[];
  removed?: string[];
}

export interface GitHubPushEvent {
  action?: string;
  ref?: string;
  after?: string;
  number?: number;
  repository?: { full_name?: string };
  sender?: { login?: string };
  installation?: { id?: number };
  pull_request?: {
    number?: number;
    merged?: boolean;
    head?: {
      ref?: string;
      sha?: string;
    };
    user?: {
      login?: string;
    };
  };
  commits?: WebhookCommitChangeSet[];
}

export interface GitLabPushEvent {
  ref?: string;
  after?: string;
  checkout_sha?: string;
  event_name?: string;
  object_kind?: string;
  project?: { path_with_namespace?: string; id?: number };
  user_name?: string;
  user?: { username?: string; name?: string };
  object_attributes?: {
    iid?: number;
    action?: string;
    state?: string;
    source_branch?: string;
    last_commit?: {
      id?: string;
    };
  };
  commits?: WebhookCommitChangeSet[];
}

export interface WebhookDeployFailure {
  projectId: string;
  projectName: string;
  serviceId: string;
  status: string;
  entity?: string;
  message?: string;
}

export interface WebhookIgnoredTarget {
  projectId: string;
  projectName: string;
  reason: "branch_mismatch" | "path_filter" | "no_compose_services";
  branch?: string;
  targetBranch?: string;
  watchedPaths?: string[];
  changedPaths?: string[];
  matchedPaths?: string[];
}

export type WebhookTarget = {
  project: typeof projects.$inferSelect;
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect | null;
};
