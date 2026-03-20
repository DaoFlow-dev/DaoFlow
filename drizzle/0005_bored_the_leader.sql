CREATE TABLE "webhook_deliveries" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"provider_type" varchar(20) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"delivery_key" varchar(200) NOT NULL,
	"delivery_id" varchar(200),
	"repo_full_name" varchar(255),
	"external_installation_id" varchar(40),
	"commit_sha" varchar(64),
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_key_idx" ON "webhook_deliveries" USING btree ("provider_type","delivery_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_repo_idx" ON "webhook_deliveries" USING btree ("repo_full_name");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");