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
  label?: { name?: string };
  issue?: {
    id?: number;
    number?: number;
    html_url?: string;
    title?: string;
    body?: string | null;
    user?: {
      login?: string;
    };
    labels?: { name?: string }[];
    pull_request?: unknown;
  };
  comment?: {
    id?: number;
    html_url?: string;
    body?: string;
    user?: {
      login?: string;
    };
  };
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
  action?: string;
  ref?: string;
  after?: string;
  checkout_sha?: string;
  event_name?: string;
  event_type?: string;
  object_kind?: string;
  project?: { path_with_namespace?: string; id?: number; web_url?: string };
  user_name?: string;
  user_username?: string;
  user?: { username?: string; name?: string };
  labels?: { title?: string; name?: string }[];
  changes?: {
    labels?: unknown;
  };
  issue?: {
    id?: number;
    iid?: number;
    title?: string;
    description?: string | null;
    url?: string;
    web_url?: string;
    labels?: { title?: string; name?: string }[];
    author?: { username?: string; name?: string };
  };
  object_attributes?: {
    id?: number;
    iid?: number;
    action?: string;
    state?: string;
    title?: string;
    description?: string | null;
    url?: string;
    source_branch?: string;
    note?: string;
    noteable_type?: string;
    labels?: { title?: string; name?: string }[];
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
