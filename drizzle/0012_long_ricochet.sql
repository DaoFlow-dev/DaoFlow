CREATE TABLE "server_operation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" varchar(32) NOT NULL,
	"stream" varchar(20) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_operations" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"requested_by_user_id" text,
	"requested_by_email" varchar(320),
	"requested_by_role" varchar(20),
	"permission_scope" varchar(60),
	"summary" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_operation_logs" ADD CONSTRAINT "server_operation_logs_operation_id_server_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."server_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_operations" ADD CONSTRAINT "server_operations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_operations" ADD CONSTRAINT "server_operations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_operation_logs_operation_idx" ON "server_operation_logs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "server_operation_logs_created_at_idx" ON "server_operation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "server_operations_server_idx" ON "server_operations" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_operations_kind_idx" ON "server_operations" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "server_operations_status_idx" ON "server_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "server_operations_created_at_idx" ON "server_operations" USING btree ("created_at");