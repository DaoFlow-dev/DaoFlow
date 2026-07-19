CREATE TABLE "control_plane_recovery_bundles" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"owner_team_id" varchar(32) NOT NULL,
	"destination_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"app_version" varchar(32) NOT NULL,
	"schema_version" varchar(128) NOT NULL,
	"key_fingerprint" varchar(64) NOT NULL,
	"key_rotated_at" timestamp,
	"object_prefix" text NOT NULL,
	"bundle_object_path" text NOT NULL,
	"manifest_object_path" text NOT NULL,
	"latest_manifest_object_path" text NOT NULL,
	"bundle_checksum" varchar(64),
	"database_checksum" varchar(64),
	"size_bytes" text,
	"manifest" jsonb,
	"verification_result" jsonb,
	"temporal_workflow_id" text,
	"error" text,
	"requested_by_user_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "control_plane_recovery_status_check" CHECK ("control_plane_recovery_bundles"."status" IN ('queued', 'running', 'verified', 'failed')),
	CONSTRAINT "control_plane_recovery_format_version_check" CHECK ("control_plane_recovery_bundles"."format_version" = 1)
);
--> statement-breakpoint
ALTER TABLE "control_plane_recovery_bundles" ADD CONSTRAINT "control_plane_recovery_bundles_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_recovery_bundles" ADD CONSTRAINT "control_plane_recovery_bundles_destination_id_backup_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."backup_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_recovery_bundles" ADD CONSTRAINT "control_plane_recovery_bundles_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_plane_recovery_team_idx" ON "control_plane_recovery_bundles" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "control_plane_recovery_destination_idx" ON "control_plane_recovery_bundles" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "control_plane_recovery_status_idx" ON "control_plane_recovery_bundles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "control_plane_recovery_created_at_idx" ON "control_plane_recovery_bundles" USING btree ("created_at");