import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { gitInstallations } from "./git-providers";
import { projects } from "./projects";
import { servers } from "./servers";

export const DEVELOPMENT_TASK_STATUSES = [
  "queued",
  "running",
  "waiting_review",
  "blocked",
  "failed",
  "canceled",
  "completed"
] as const;

export const DEVELOPMENT_TASK_RUN_STATUSES = [
  "queued",
  "claimed",
  "preparing",
  "coding",
  "validating",
  "opening_pr",
  "deploying_preview",
  "waiting_review",
  "failed",
  "canceled",
  "completed"
] as const;

export const DEVELOPMENT_TASK_PROVIDERS = ["github", "gitlab"] as const;
export const SANDBOX_RUNNER_PROVIDERS = ["host_docker", "sandbank_boxlite"] as const;
export const CODEX_AUTH_MODES = ["api_key", "chatgpt_auth_json", "custom_provider_env"] as const;

export const developmentTasks = pgTable(
  "development_tasks",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    providerType: varchar("provider_type", { length: 20 }).notNull(),
    providerInstallationId: varchar("provider_installation_id", { length: 32 }).references(
      () => gitInstallations.id,
      { onDelete: "set null" }
    ),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repoFullName: varchar("repo_full_name", { length: 255 }).notNull(),
    externalIssueId: varchar("external_issue_id", { length: 80 }).notNull(),
    issueNumber: integer("issue_number").notNull(),
    issueUrl: text("issue_url").notNull(),
    issueTitle: text("issue_title").notNull(),
    issueAuthor: varchar("issue_author", { length: 120 }),
    baseBranch: varchar("base_branch", { length: 120 }).default("main").notNull(),
    status: varchar("status", { length: 24 }).default("queued").notNull(),
    priority: integer("priority").default(100).notNull(),
    requestedByExternalUser: varchar("requested_by_external_user", { length: 120 }),
    requestedByPrincipalId: varchar("requested_by_principal_id", { length: 320 }),
    currentRunId: varchar("current_run_id", { length: 32 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("development_tasks_provider_issue_idx").on(
      table.providerType,
      table.repoFullName,
      table.externalIssueId
    ),
    index("development_tasks_project_idx").on(table.projectId),
    index("development_tasks_status_idx").on(table.status),
    index("development_tasks_priority_idx").on(table.priority),
    index("development_tasks_created_at_idx").on(table.createdAt)
  ]
);

export const sandboxRunnerProfiles = pgTable(
  "sandbox_runner_profiles",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 20 }).default("host_docker").notNull(),
    serverId: varchar("server_id", { length: 32 }).references(() => servers.id, {
      onDelete: "set null"
    }),
    image: varchar("image", { length: 255 }).notNull(),
    cpuLimit: integer("cpu_limit").default(2).notNull(),
    memoryLimitMb: integer("memory_limit_mb").default(4096).notNull(),
    diskLimitMb: integer("disk_limit_mb").default(20480).notNull(),
    networkPolicy: varchar("network_policy", { length: 40 }).default("default-egress").notNull(),
    allowedCommands: jsonb("allowed_commands").default([]).notNull(),
    validationCommands: jsonb("validation_commands").default([]).notNull(),
    timeoutMinutes: integer("timeout_minutes").default(60).notNull(),
    codexAuthMode: varchar("codex_auth_mode", { length: 40 }).default("api_key").notNull(),
    codexConfigTemplate: text("codex_config_template"),
    status: varchar("status", { length: 20 }).default("disabled").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("sandbox_runner_profiles_name_idx").on(table.name),
    index("sandbox_runner_profiles_provider_idx").on(table.provider),
    index("sandbox_runner_profiles_server_idx").on(table.serverId),
    index("sandbox_runner_profiles_status_idx").on(table.status)
  ]
);

export const developmentTaskRuns = pgTable(
  "development_task_runs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    taskId: varchar("task_id", { length: 32 })
      .notNull()
      .references(() => developmentTasks.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).default("queued").notNull(),
    runnerId: varchar("runner_id", { length: 120 }),
    runnerProfileId: varchar("runner_profile_id", { length: 32 }).references(
      () => sandboxRunnerProfiles.id,
      { onDelete: "set null" }
    ),
    sandboxProvider: varchar("sandbox_provider", { length: 20 }),
    sandboxId: varchar("sandbox_id", { length: 120 }),
    codexProfile: varchar("codex_profile", { length: 80 }),
    model: varchar("model", { length: 80 }),
    reasoningEffort: varchar("reasoning_effort", { length: 20 }),
    branchName: varchar("branch_name", { length: 160 }),
    commitSha: varchar("commit_sha", { length: 64 }),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestUrl: text("pull_request_url"),
    previewDeploymentId: varchar("preview_deployment_id", { length: 32 }),
    previewUrl: text("preview_url"),
    failureCategory: varchar("failure_category", { length: 60 }),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata").default({}).notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("development_task_runs_task_idx").on(table.taskId),
    index("development_task_runs_status_idx").on(table.status),
    index("development_task_runs_runner_profile_idx").on(table.runnerProfileId),
    index("development_task_runs_created_at_idx").on(table.createdAt)
  ]
);

export const developmentTaskEvents = pgTable(
  "development_task_events",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    taskId: varchar("task_id", { length: 32 })
      .notNull()
      .references(() => developmentTasks.id, { onDelete: "cascade" }),
    runId: varchar("run_id", { length: 32 }).references(() => developmentTaskRuns.id, {
      onDelete: "cascade"
    }),
    kind: varchar("kind", { length: 80 }).notNull(),
    summary: text("summary").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("development_task_events_task_idx").on(table.taskId),
    index("development_task_events_run_idx").on(table.runId),
    index("development_task_events_kind_idx").on(table.kind),
    index("development_task_events_created_at_idx").on(table.createdAt)
  ]
);

export const developmentTaskComments = pgTable(
  "development_task_comments",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    taskId: varchar("task_id", { length: 32 })
      .notNull()
      .references(() => developmentTasks.id, { onDelete: "cascade" }),
    runId: varchar("run_id", { length: 32 }).references(() => developmentTaskRuns.id, {
      onDelete: "set null"
    }),
    providerType: varchar("provider_type", { length: 20 }).notNull(),
    externalCommentId: varchar("external_comment_id", { length: 120 }).notNull(),
    commentKind: varchar("comment_kind", { length: 40 }).notNull(),
    lastBodyHash: varchar("last_body_hash", { length: 64 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("development_task_comments_provider_comment_idx").on(
      table.providerType,
      table.externalCommentId
    ),
    index("development_task_comments_task_idx").on(table.taskId),
    index("development_task_comments_run_idx").on(table.runId),
    index("development_task_comments_kind_idx").on(table.commentKind)
  ]
);

export const developmentTasksRelations = relations(developmentTasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [developmentTasks.projectId],
    references: [projects.id]
  }),
  providerInstallation: one(gitInstallations, {
    fields: [developmentTasks.providerInstallationId],
    references: [gitInstallations.id]
  }),
  runs: many(developmentTaskRuns),
  events: many(developmentTaskEvents),
  comments: many(developmentTaskComments)
}));

export const sandboxRunnerProfilesRelations = relations(sandboxRunnerProfiles, ({ one, many }) => ({
  server: one(servers, {
    fields: [sandboxRunnerProfiles.serverId],
    references: [servers.id]
  }),
  runs: many(developmentTaskRuns)
}));

export const developmentTaskRunsRelations = relations(developmentTaskRuns, ({ one, many }) => ({
  task: one(developmentTasks, {
    fields: [developmentTaskRuns.taskId],
    references: [developmentTasks.id]
  }),
  runnerProfile: one(sandboxRunnerProfiles, {
    fields: [developmentTaskRuns.runnerProfileId],
    references: [sandboxRunnerProfiles.id]
  }),
  events: many(developmentTaskEvents),
  comments: many(developmentTaskComments)
}));

export const developmentTaskEventsRelations = relations(developmentTaskEvents, ({ one }) => ({
  task: one(developmentTasks, {
    fields: [developmentTaskEvents.taskId],
    references: [developmentTasks.id]
  }),
  run: one(developmentTaskRuns, {
    fields: [developmentTaskEvents.runId],
    references: [developmentTaskRuns.id]
  })
}));

export const developmentTaskCommentsRelations = relations(developmentTaskComments, ({ one }) => ({
  task: one(developmentTasks, {
    fields: [developmentTaskComments.taskId],
    references: [developmentTasks.id]
  }),
  run: one(developmentTaskRuns, {
    fields: [developmentTaskComments.runId],
    references: [developmentTaskRuns.id]
  })
}));
