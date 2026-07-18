ALTER TABLE "backup_restores" ADD COLUMN "mode" varchar(20) DEFAULT 'restore' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD COLUMN "verification_result" jsonb;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "artifact_format" varchar(40);--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "database_engine_version" varchar(64);--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "database_image_reference" text;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "artifact_checked_at" timestamp;