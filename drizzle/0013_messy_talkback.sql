CREATE TABLE "log_drain_deliveries" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"drain_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"http_status" varchar(5),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_body" text,
	"error" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "log_drains" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"destination_type" varchar(40) NOT NULL,
	"endpoint_url" text NOT NULL,
	"headers_encrypted" text,
	"service_filter" varchar(100),
	"environment_filter" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_delivered_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_drain_deliveries" ADD CONSTRAINT "log_drain_deliveries_drain_id_log_drains_id_fk" FOREIGN KEY ("drain_id") REFERENCES "public"."log_drains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_drain_deliveries_drain_id_idx" ON "log_drain_deliveries" USING btree ("drain_id");--> statement-breakpoint
CREATE INDEX "log_drain_deliveries_status_idx" ON "log_drain_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "log_drain_deliveries_attempted_at_idx" ON "log_drain_deliveries" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "log_drains_team_id_idx" ON "log_drains" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "log_drains_destination_type_idx" ON "log_drains" USING btree ("destination_type");--> statement-breakpoint
CREATE INDEX "log_drains_status_idx" ON "log_drains" USING btree ("status");