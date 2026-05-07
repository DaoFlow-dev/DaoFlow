CREATE TABLE "request_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(80) NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(240) NOT NULL,
	"category" varchar(40) NOT NULL,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"error_category" varchar(60),
	"auth_method" varchar(20),
	"actor_type" varchar(20),
	"actor_id" varchar(320),
	"actor_email" varchar(320),
	"actor_role" varchar(20),
	"token_id" varchar(32),
	"token_prefix" varchar(12),
	"source_ip" varchar(80),
	"user_agent" varchar(240),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_used_ip" varchar(80);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "last_failure_ip" varchar(80);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "recent_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_access_logs" ADD CONSTRAINT "request_access_logs_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_access_logs_request_id_idx" ON "request_access_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_access_logs_category_idx" ON "request_access_logs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "request_access_logs_status_idx" ON "request_access_logs" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "request_access_logs_token_id_idx" ON "request_access_logs" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "request_access_logs_actor_id_idx" ON "request_access_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "request_access_logs_created_at_idx" ON "request_access_logs" USING btree ("created_at");