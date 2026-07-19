ALTER TABLE "control_plane_recovery_bundles" ADD COLUMN "idempotency_key" varchar(71);--> statement-breakpoint
ALTER TABLE "control_plane_recovery_bundles" ADD COLUMN "temporal_run_id" text;--> statement-breakpoint
ALTER TABLE "control_plane_recovery_bundles" ADD COLUMN "dispatched_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "control_plane_recovery_request_idempotency_idx" ON "control_plane_recovery_bundles" USING btree ("owner_team_id","requested_by_user_id","idempotency_key");