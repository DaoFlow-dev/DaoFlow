CREATE TABLE "service_schedule_monitor_leases" (
	"lease_key" varchar(32) PRIMARY KEY NOT NULL,
	"holder_instance_id" varchar(32) NOT NULL,
	"generation" integer NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD COLUMN "lease_generation" integer;--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD COLUMN "lease_holder_instance_id" varchar(32);--> statement-breakpoint
ALTER TABLE "service_schedule_runs" ADD COLUMN "runner_instance_id" varchar(32);--> statement-breakpoint
CREATE INDEX "service_schedule_monitor_leases_expires_idx" ON "service_schedule_monitor_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_schedule_runs_schedule_scheduled_for_unique" ON "service_schedule_runs" USING btree ("schedule_id","scheduled_for");