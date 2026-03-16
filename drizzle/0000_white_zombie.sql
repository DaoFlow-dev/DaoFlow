CREATE TABLE "user_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(100),
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp,
	"password_hash" varchar(255),
	"provider_metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(256),
	"username" varchar(50),
	"email_verified" boolean DEFAULT false NOT NULL,
	"has_avatar" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"default_team_id" varchar(32),
	"tokens_invalid_before" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(40),
	"has_avatar" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"environment_id" varchar(32) NOT NULL,
	"key" varchar(80) NOT NULL,
	"value_encrypted" text NOT NULL,
	"is_secret" varchar(5) DEFAULT 'false' NOT NULL,
	"category" varchar(20) DEFAULT 'runtime' NOT NULL,
	"branch_pattern" varchar(120),
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(40),
	"team_id" varchar(32) NOT NULL,
	"repo_full_name" varchar(255),
	"repo_url" text,
	"source_type" varchar(20) DEFAULT 'compose' NOT NULL,
	"compose_path" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"git_provider_id" varchar(32),
	"git_installation_id" varchar(32),
	"default_branch" varchar(80) DEFAULT 'main',
	"auto_deploy" boolean DEFAULT false NOT NULL,
	"auto_deploy_branch" varchar(120),
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"host" varchar(120) NOT NULL,
	"region" varchar(60),
	"ssh_port" integer DEFAULT 22 NOT NULL,
	"kind" varchar(30) DEFAULT 'docker-engine' NOT NULL,
	"status" varchar(30) DEFAULT 'pending verification' NOT NULL,
	"docker_version" varchar(40),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"registered_by_user_id" text,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" varchar(32) NOT NULL,
	"level" varchar(10) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"source" varchar(40),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" varchar(32) NOT NULL,
	"label" varchar(80) NOT NULL,
	"detail" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"sort_order" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"environment_id" varchar(32) NOT NULL,
	"target_server_id" varchar(32) NOT NULL,
	"service_name" varchar(80) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"commit_sha" varchar(40),
	"image_tag" varchar(160),
	"config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"env_vars_encrypted" text,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"conclusion" varchar(20),
	"trigger" varchar(20) DEFAULT 'user' NOT NULL,
	"requested_by_user_id" text,
	"requested_by_email" varchar(320),
	"requested_by_role" varchar(20),
	"container_id" varchar(64),
	"error" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"concluded_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_policies" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"volume_id" varchar(32) NOT NULL,
	"schedule" varchar(60),
	"retention_days" integer DEFAULT 30 NOT NULL,
	"storage_target" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_restores" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"backup_run_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"target_path" text,
	"triggered_by_user_id" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"policy_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"artifact_path" text,
	"size_bytes" text,
	"triggered_by_user_id" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volumes" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"mount_path" text NOT NULL,
	"size_bytes" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"action_type" varchar(40) NOT NULL,
	"target_resource" varchar(200) NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text,
	"requested_by_email" varchar(320),
	"requested_by_role" varchar(20),
	"resolved_by_user_id" text,
	"resolved_by_email" varchar(320),
	"input_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" varchar(320) NOT NULL,
	"actor_email" varchar(320),
	"actor_role" varchar(20),
	"organization_id" varchar(32),
	"target_resource" varchar(200) NOT NULL,
	"action" varchar(80) NOT NULL,
	"input_summary" text,
	"permission_scope" varchar(60),
	"outcome" varchar(20) DEFAULT 'success' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(60) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" varchar(32) NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"severity" varchar(10) DEFAULT 'info' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_prefix" varchar(12) NOT NULL,
	"principal_type" varchar(20) NOT NULL,
	"principal_id" varchar(320) NOT NULL,
	"scopes" text NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"linked_user_id" text,
	"default_scopes" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnel_routes" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"tunnel_id" varchar(32) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"service" varchar(255) NOT NULL,
	"path" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnels" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"tunnel_id" varchar(80),
	"credentials_encrypted" text,
	"domain" varchar(255),
	"status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"environment_id" varchar(32) NOT NULL,
	"target_server_id" varchar(32),
	"source_type" varchar(20) DEFAULT 'compose' NOT NULL,
	"image_reference" varchar(255),
	"dockerfile_path" text,
	"compose_service_name" varchar(100),
	"port" varchar(20),
	"healthcheck_path" varchar(255),
	"replica_count" varchar(5) DEFAULT '1' NOT NULL,
	"status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_installations" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"provider_id" varchar(32) NOT NULL,
	"installation_id" varchar(40) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_type" varchar(20) DEFAULT 'organization' NOT NULL,
	"repository_selection" varchar(20) DEFAULT 'all' NOT NULL,
	"permissions" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_providers" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"type" varchar(20) DEFAULT 'github' NOT NULL,
	"name" varchar(100) NOT NULL,
	"app_id" varchar(40),
	"client_id" varchar(80),
	"client_secret_encrypted" text,
	"private_key_encrypted" text,
	"webhook_secret" varchar(128),
	"base_url" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_git_provider_id_git_providers_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_git_installation_id_git_installations_id_fk" FOREIGN KEY ("git_installation_id") REFERENCES "public"."git_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_steps" ADD CONSTRAINT "deployment_steps_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_target_server_id_servers_id_fk" FOREIGN KEY ("target_server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_volume_id_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."volumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_policy_id_backup_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."backup_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnel_routes" ADD CONSTRAINT "tunnel_routes_tunnel_id_tunnels_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "public"."tunnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_target_server_id_servers_id_fk" FOREIGN KEY ("target_server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_installations" ADD CONSTRAINT "git_installations_provider_id_git_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."git_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identities_provider_idx" ON "user_identities" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_user_idx" ON "user_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "team_invites_team_id_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_invites_email_idx" ON "team_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "team_members_team_id_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "teams_name_idx" ON "teams" USING btree ("name");--> statement-breakpoint
CREATE INDEX "teams_created_at_idx" ON "teams" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "env_vars_environment_id_idx" ON "environment_variables" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_env_key_idx" ON "environment_variables" USING btree ("environment_id","key");--> statement-breakpoint
CREATE INDEX "environments_project_id_idx" ON "environments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_idx" ON "environments" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "projects_team_id_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "projects_created_at_idx" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_name_idx" ON "servers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_host_idx" ON "servers" USING btree ("host");--> statement-breakpoint
CREATE INDEX "servers_region_idx" ON "servers" USING btree ("region");--> statement-breakpoint
CREATE INDEX "servers_created_at_idx" ON "servers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deployment_logs_deployment_id_idx" ON "deployment_logs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "deployment_logs_created_at_idx" ON "deployment_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deployment_steps_deployment_id_idx" ON "deployment_steps" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "deployments_project_id_idx" ON "deployments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployments_environment_id_idx" ON "deployments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "deployments_server_id_idx" ON "deployments" USING btree ("target_server_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_created_at_idx" ON "deployments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backup_policies_volume_id_idx" ON "backup_policies" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "backup_restores_backup_run_id_idx" ON "backup_restores" USING btree ("backup_run_id");--> statement-breakpoint
CREATE INDEX "backup_restores_created_at_idx" ON "backup_restores" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backup_runs_policy_id_idx" ON "backup_runs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "backup_runs_status_idx" ON "backup_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backup_runs_created_at_idx" ON "backup_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "volumes_server_id_idx" ON "volumes" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "volumes_name_idx" ON "volumes" USING btree ("name");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_action_type_idx" ON "approval_requests" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "approval_requests_created_at_idx" ON "approval_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entries_actor_id_idx" ON "audit_entries" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_entries_action_idx" ON "audit_entries" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_entries_target_resource_idx" ON "audit_entries" USING btree ("target_resource");--> statement-breakpoint
CREATE INDEX "audit_entries_created_at_idx" ON "audit_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_kind_idx" ON "events" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "events_resource_idx" ON "events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_severity_idx" ON "events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "api_tokens_principal_idx" ON "api_tokens" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_status_idx" ON "api_tokens" USING btree ("status");--> statement-breakpoint
CREATE INDEX "api_tokens_created_at_idx" ON "api_tokens" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "principals_type_idx" ON "principals" USING btree ("type");--> statement-breakpoint
CREATE INDEX "principals_name_idx" ON "principals" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tunnel_routes_tunnel_id_idx" ON "tunnel_routes" USING btree ("tunnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnel_routes_hostname_idx" ON "tunnel_routes" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnels_name_team_idx" ON "tunnels" USING btree ("name","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnels_tunnel_id_idx" ON "tunnels" USING btree ("tunnel_id");--> statement-breakpoint
CREATE INDEX "services_project_id_idx" ON "services" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "services_environment_id_idx" ON "services" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_env_slug_idx" ON "services" USING btree ("environment_id","slug");--> statement-breakpoint
CREATE INDEX "git_installations_provider_id_idx" ON "git_installations" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_installations_provider_install_idx" ON "git_installations" USING btree ("provider_id","installation_id");--> statement-breakpoint
CREATE INDEX "git_providers_type_idx" ON "git_providers" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "git_providers_name_idx" ON "git_providers" USING btree ("name");