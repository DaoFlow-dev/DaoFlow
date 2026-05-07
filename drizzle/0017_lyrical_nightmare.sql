CREATE TABLE "request_access_logs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"request_id" varchar(80) NOT NULL,
	"method" varchar(12) NOT NULL,
	"path" varchar(255) NOT NULL,
	"category" varchar(30) DEFAULT 'api' NOT NULL,
	"status_code" integer NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"duration_ms" integer NOT NULL,
	"auth_method" varchar(20),
	"actor_type" varchar(20),
	"actor_id" varchar(320),
	"actor_email" varchar(320),
	"actor_role" varchar(20),
	"token_id" varchar(32),
	"token_name" varchar(80),
	"token_prefix" varchar(12),
	"source_ip" varchar(80),
	"user_agent" varchar(255),
	"error_category" varchar(80),
	"required_scopes" text,
	"granted_scopes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_used_ip" varchar(80);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_used_user_agent" varchar(255);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_failure_code" varchar(80);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_failure_ip" varchar(80);--> statement-breakpoint
CREATE INDEX "request_access_logs_request_id_idx" ON "request_access_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_access_logs_created_at_idx" ON "request_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "request_access_logs_path_idx" ON "request_access_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "request_access_logs_status_idx" ON "request_access_logs" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "request_access_logs_category_idx" ON "request_access_logs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "request_access_logs_outcome_idx" ON "request_access_logs" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "request_access_logs_token_idx" ON "request_access_logs" USING btree ("token_id");