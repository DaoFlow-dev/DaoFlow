CREATE TABLE "provider_feedback" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"sequence" serial NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"target_id" varchar(32) NOT NULL,
	"deployment_id" varchar(32) NOT NULL,
	"provider_id" varchar(32) NOT NULL,
	"provider_kind" varchar(20) NOT NULL,
	"transition" varchar(40) NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"safe_error" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_deployment_id" varchar(255),
	"external_status_id" varchar(255),
	"external_comment_id" varchar(255),
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_feedback_targets" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"deployment_id" varchar(32) NOT NULL,
	"provider_id" varchar(32) NOT NULL,
	"provider_kind" varchar(20) NOT NULL,
	"external_deployment_id" varchar(255),
	"external_status_id" varchar(255),
	"external_comment_id" varchar(255),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_feedback" ADD CONSTRAINT "provider_feedback_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback" ADD CONSTRAINT "provider_feedback_target_id_provider_feedback_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."provider_feedback_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback" ADD CONSTRAINT "provider_feedback_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback_targets" ADD CONSTRAINT "provider_feedback_targets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback_targets" ADD CONSTRAINT "provider_feedback_targets_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_feedback_idempotency_key_idx" ON "provider_feedback" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_feedback_sequence_idx" ON "provider_feedback" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "provider_feedback_deployment_id_idx" ON "provider_feedback" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "provider_feedback_team_state_created_at_idx" ON "provider_feedback" USING btree ("team_id","state","created_at");--> statement-breakpoint
CREATE INDEX "provider_feedback_claim_idx" ON "provider_feedback" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "provider_feedback_lease_expires_at_idx" ON "provider_feedback" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "provider_feedback_target_state_sequence_idx" ON "provider_feedback" USING btree ("target_id","state","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_feedback_targets_deployment_idx" ON "provider_feedback_targets" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "provider_feedback_targets_team_id_idx" ON "provider_feedback_targets" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "provider_feedback_targets_lease_expires_at_idx" ON "provider_feedback_targets" USING btree ("lease_expires_at");