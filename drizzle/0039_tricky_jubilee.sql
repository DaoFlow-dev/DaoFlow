CREATE TABLE "webhook_delivery_attempts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"delivery_id" varchar(32) NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"lease_owner" varchar(128) NOT NULL,
	"lease_expires_at" timestamp NOT NULL,
	"error_summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_targets" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"delivery_id" varchar(32) NOT NULL,
	"target_key" varchar(80) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_attempt_id" varchar(32),
	"detail" text,
	"error_summary" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "body_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "current_attempt_id" varchar(32);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error_summary" text;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_targets" ADD CONSTRAINT "webhook_delivery_targets_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_targets" ADD CONSTRAINT "webhook_delivery_targets_last_attempt_id_webhook_delivery_attempts_id_fk" FOREIGN KEY ("last_attempt_id") REFERENCES "public"."webhook_delivery_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_attempts_delivery_number_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_status_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","status");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_lease_expiry_idx" ON "webhook_delivery_attempts" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_targets_delivery_key_idx" ON "webhook_delivery_targets" USING btree ("delivery_id","target_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_targets_retry_idx" ON "webhook_delivery_targets" USING btree ("delivery_id","status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_recovery_status_seen_idx" ON "webhook_deliveries" USING btree ("status","last_seen_at");