CREATE TABLE "approval_action_dispatches" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"approval_request_id" varchar(32) NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"action_type" varchar(40) NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"operation_id" varchar(32) NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"action_payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"dispatched_at" timestamp,
	"last_reconciled_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_action_dispatches" ADD CONSTRAINT "approval_action_dispatches_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action_dispatches" ADD CONSTRAINT "approval_action_dispatches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_action_dispatches_request_idx" ON "approval_action_dispatches" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_action_dispatches_team_idempotency_idx" ON "approval_action_dispatches" USING btree ("team_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "approval_action_dispatches_status_next_attempt_idx" ON "approval_action_dispatches" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "approval_action_dispatches_lease_expires_at_idx" ON "approval_action_dispatches" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "approval_action_dispatches_reconciliation_idx" ON "approval_action_dispatches" USING btree ("status","last_reconciled_at");--> statement-breakpoint
CREATE INDEX "approval_action_dispatches_operation_id_idx" ON "approval_action_dispatches" USING btree ("operation_id");