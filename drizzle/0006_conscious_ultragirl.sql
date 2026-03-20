CREATE TABLE "cli_auth_requests" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_code" varchar(16) NOT NULL,
	"exchange_code" varchar(40),
	"session_token_encrypted" text,
	"approved_by_user_id" text,
	"approved_by_email" varchar(320),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"approved_at" timestamp,
	"exchanged_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "preview_key" varchar(80);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "preview_action" varchar(20);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "cli_auth_requests" ADD CONSTRAINT "cli_auth_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_auth_requests_user_code_idx" ON "cli_auth_requests" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "cli_auth_requests_exchange_code_idx" ON "cli_auth_requests" USING btree ("exchange_code");--> statement-breakpoint
CREATE INDEX "cli_auth_requests_expires_at_idx" ON "cli_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cli_auth_requests_approved_by_user_id_idx" ON "cli_auth_requests" USING btree ("approved_by_user_id");