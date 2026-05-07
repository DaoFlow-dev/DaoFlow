CREATE TABLE "preview_environments" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"environment_id" varchar(32) NOT NULL,
	"service_id" varchar(32) NOT NULL,
	"provider_type" varchar(20) DEFAULT 'manual' NOT NULL,
	"preview_key" varchar(120) NOT NULL,
	"target" varchar(20) NOT NULL,
	"branch" varchar(255) NOT NULL,
	"pull_request_number" integer,
	"env_branch" varchar(255) NOT NULL,
	"stack_name" varchar(80) NOT NULL,
	"primary_domain" varchar(255),
	"status" varchar(20) DEFAULT 'deploying' NOT NULL,
	"cleanup_status" varchar(20) DEFAULT 'not_requested' NOT NULL,
	"last_deployment_id" varchar(32),
	"last_deployment_status" varchar(20),
	"last_deployment_conclusion" varchar(20),
	"last_deployment_action" varchar(20) DEFAULT 'deploy' NOT NULL,
	"last_deployment_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"stale_at" timestamp,
	"cleanup_requested_at" timestamp,
	"cleanup_completed_at" timestamp,
	"cleanup_deployment_id" varchar(32),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preview_envs_service_key_idx" ON "preview_environments" USING btree ("service_id","preview_key");--> statement-breakpoint
CREATE INDEX "preview_envs_team_status_idx" ON "preview_environments" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "preview_envs_project_idx" ON "preview_environments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "preview_envs_environment_idx" ON "preview_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "preview_envs_service_idx" ON "preview_environments" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "preview_envs_last_deployment_idx" ON "preview_environments" USING btree ("last_deployment_id");--> statement-breakpoint
CREATE INDEX "preview_envs_cleanup_status_idx" ON "preview_environments" USING btree ("cleanup_status");