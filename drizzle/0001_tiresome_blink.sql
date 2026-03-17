CREATE TABLE "backup_destinations" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" varchar(30) NOT NULL,
	"access_key" text,
	"secret_access_key" text,
	"bucket" text,
	"region" varchar(40),
	"endpoint" text,
	"s3_provider" varchar(40),
	"rclone_type" varchar(30),
	"rclone_config" text,
	"rclone_remote_path" text,
	"oauth_token" text,
	"oauth_token_expiry" timestamp,
	"encryption_mode" varchar(20) DEFAULT 'none' NOT NULL,
	"encryption_password" text,
	"encryption_salt" text,
	"filename_encryption" varchar(20) DEFAULT 'standard',
	"local_path" text,
	"quota_bytes" text,
	"quota_warning_percent" integer DEFAULT 80,
	"organization_id" varchar(32),
	"last_tested_at" timestamp,
	"last_test_result" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"webhook_url" text,
	"email" text,
	"event_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"project_filter" varchar(100),
	"environment_filter" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"http_status" varchar(5),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_notification_overrides" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"user_id" text,
	"channel_type" varchar(20) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_pushed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_providers" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"config_encrypted" text NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_tested_at" timestamp,
	"created_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN "source" varchar(20) DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN "secret_ref" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "ssh_key_id" varchar(64);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "compose_version" varchar(40);--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "backup_type" varchar(20) DEFAULT 'volume' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "database_engine" varchar(20);--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "turn_off" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "retention_daily" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "retention_weekly" integer DEFAULT 4;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "retention_monthly" integer DEFAULT 12;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "max_backups" integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "destination_id" varchar(32);--> statement-breakpoint
ALTER TABLE "backup_policies" ADD COLUMN "temporal_workflow_id" varchar(100);--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "checksum" varchar(128);--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_providers" ADD CONSTRAINT "secret_providers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_providers" ADD CONSTRAINT "secret_providers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_destinations_provider_idx" ON "backup_destinations" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "backup_destinations_org_idx" ON "backup_destinations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_channels_type_idx" ON "notification_channels" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "notification_channels_enabled_idx" ON "notification_channels" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "notification_logs_channel_id_idx" ON "notification_logs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notification_logs_event_type_idx" ON "notification_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notification_logs_sent_at_idx" ON "notification_logs" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "project_notification_overrides_project_id_idx" ON "project_notification_overrides" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_notification_overrides_user_id_idx" ON "project_notification_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "user_notification_prefs_user_id_idx" ON "user_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_notification_prefs_channel_type_idx" ON "user_notification_preferences" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "secret_providers_team_id_idx" ON "secret_providers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "secret_providers_type_idx" ON "secret_providers" USING btree ("type");--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_destination_id_backup_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."backup_destinations"("id") ON DELETE set null ON UPDATE no action;