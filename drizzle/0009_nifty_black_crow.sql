CREATE TABLE "development_task_comments" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"task_id" varchar(32) NOT NULL,
	"run_id" varchar(32),
	"provider_type" varchar(20) NOT NULL,
	"external_comment_id" varchar(120) NOT NULL,
	"comment_kind" varchar(40) NOT NULL,
	"last_body_hash" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_task_events" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"task_id" varchar(32) NOT NULL,
	"run_id" varchar(32),
	"kind" varchar(80) NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_task_runs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"task_id" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"runner_id" varchar(120),
	"runner_profile_id" varchar(32),
	"sandbox_provider" varchar(20),
	"sandbox_id" varchar(120),
	"codex_profile" varchar(80),
	"model" varchar(80),
	"reasoning_effort" varchar(20),
	"branch_name" varchar(160),
	"commit_sha" varchar(64),
	"pull_request_number" integer,
	"pull_request_url" text,
	"preview_deployment_id" varchar(32),
	"preview_url" text,
	"failure_category" varchar(60),
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_tasks" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"provider_type" varchar(20) NOT NULL,
	"provider_installation_id" varchar(32),
	"project_id" varchar(32) NOT NULL,
	"repo_full_name" varchar(255) NOT NULL,
	"external_issue_id" varchar(80) NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_url" text NOT NULL,
	"issue_title" text NOT NULL,
	"issue_author" varchar(120),
	"base_branch" varchar(120) DEFAULT 'main' NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"requested_by_external_user" varchar(120),
	"requested_by_principal_id" varchar(320),
	"current_run_id" varchar(32),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_runner_profiles" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" varchar(20) DEFAULT 'host_docker' NOT NULL,
	"server_id" varchar(32),
	"image" varchar(255) NOT NULL,
	"cpu_limit" integer DEFAULT 2 NOT NULL,
	"memory_limit_mb" integer DEFAULT 4096 NOT NULL,
	"disk_limit_mb" integer DEFAULT 20480 NOT NULL,
	"network_policy" varchar(40) DEFAULT 'default-egress' NOT NULL,
	"allowed_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeout_minutes" integer DEFAULT 60 NOT NULL,
	"codex_auth_mode" varchar(40) DEFAULT 'api_key' NOT NULL,
	"codex_config_template" text,
	"status" varchar(20) DEFAULT 'disabled' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "development_task_comments" ADD CONSTRAINT "development_task_comments_task_id_development_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task_comments" ADD CONSTRAINT "development_task_comments_run_id_development_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."development_task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task_events" ADD CONSTRAINT "development_task_events_task_id_development_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task_events" ADD CONSTRAINT "development_task_events_run_id_development_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."development_task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task_runs" ADD CONSTRAINT "development_task_runs_task_id_development_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task_runs" ADD CONSTRAINT "development_task_runs_runner_profile_id_sandbox_runner_profiles_id_fk" FOREIGN KEY ("runner_profile_id") REFERENCES "public"."sandbox_runner_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_provider_installation_id_git_installations_id_fk" FOREIGN KEY ("provider_installation_id") REFERENCES "public"."git_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_tasks" ADD CONSTRAINT "development_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_runner_profiles" ADD CONSTRAINT "sandbox_runner_profiles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "development_task_comments_provider_comment_idx" ON "development_task_comments" USING btree ("provider_type","external_comment_id");--> statement-breakpoint
CREATE INDEX "development_task_comments_task_idx" ON "development_task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "development_task_comments_run_idx" ON "development_task_comments" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "development_task_comments_kind_idx" ON "development_task_comments" USING btree ("comment_kind");--> statement-breakpoint
CREATE INDEX "development_task_events_task_idx" ON "development_task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "development_task_events_run_idx" ON "development_task_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "development_task_events_kind_idx" ON "development_task_events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "development_task_events_created_at_idx" ON "development_task_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "development_task_runs_task_idx" ON "development_task_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "development_task_runs_status_idx" ON "development_task_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "development_task_runs_runner_profile_idx" ON "development_task_runs" USING btree ("runner_profile_id");--> statement-breakpoint
CREATE INDEX "development_task_runs_created_at_idx" ON "development_task_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "development_tasks_provider_issue_idx" ON "development_tasks" USING btree ("provider_type","repo_full_name","external_issue_id");--> statement-breakpoint
CREATE INDEX "development_tasks_project_idx" ON "development_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "development_tasks_status_idx" ON "development_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "development_tasks_priority_idx" ON "development_tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "development_tasks_created_at_idx" ON "development_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_runner_profiles_name_idx" ON "sandbox_runner_profiles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sandbox_runner_profiles_provider_idx" ON "sandbox_runner_profiles" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "sandbox_runner_profiles_server_idx" ON "sandbox_runner_profiles" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "sandbox_runner_profiles_status_idx" ON "sandbox_runner_profiles" USING btree ("status");
