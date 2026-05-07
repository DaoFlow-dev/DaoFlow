CREATE TABLE "service_schedule_runs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"schedule_id" varchar(32) NOT NULL,
	"service_id" varchar(32) NOT NULL,
	"trigger_kind" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"command" text NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"requested_by_user_id" text,
	"requested_by_email" varchar(320),
	"requested_by_role" varchar(20),
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_schedules" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"environment_id" varchar(32) NOT NULL,
	"service_id" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"command" text NOT NULL,
	"cron_expression" varchar(120) NOT NULL,
	"timezone" varchar(80) DEFAULT 'UTC' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"retention_count" integer DEFAULT 20 NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD CONSTRAINT "service_schedule_runs_schedule_id_service_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."service_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD CONSTRAINT "service_schedule_runs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD CONSTRAINT "service_schedule_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_schedule_runs_schedule_idx" ON "service_schedule_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "service_schedule_runs_service_idx" ON "service_schedule_runs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_schedule_runs_status_idx" ON "service_schedule_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_schedule_runs_created_idx" ON "service_schedule_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "service_schedules_project_idx" ON "service_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "service_schedules_environment_idx" ON "service_schedules" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "service_schedules_service_idx" ON "service_schedules" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_schedules_status_idx" ON "service_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_schedules_next_run_idx" ON "service_schedules" USING btree ("next_run_at");