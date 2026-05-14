CREATE TABLE "server_metrics" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"cpu_percent" double precision NOT NULL,
	"memory_used_percent" double precision NOT NULL,
	"memory_used_gb" double precision NOT NULL,
	"memory_total_gb" double precision NOT NULL,
	"disk_used_percent" double precision NOT NULL,
	"disk_total_gb" double precision NOT NULL,
	"network_in_mb" double precision NOT NULL,
	"network_out_mb" double precision NOT NULL,
	"collected_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_metrics" ADD CONSTRAINT "server_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_metrics_server_idx" ON "server_metrics" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_metrics_collected_at_idx" ON "server_metrics" USING btree ("collected_at");