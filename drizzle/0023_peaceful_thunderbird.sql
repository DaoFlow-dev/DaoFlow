CREATE TABLE "ssh_host_identities" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"algorithm" varchar(80) NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"status" varchar(20) DEFAULT 'observed' NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"last_observed_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"approved_by_user_id" text,
	"superseded_at" timestamp,
	"superseded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_host_identities" ADD CONSTRAINT "ssh_host_identities_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_host_identities" ADD CONSTRAINT "ssh_host_identities_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_host_identities" ADD CONSTRAINT "ssh_host_identities_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_host_identities" ADD CONSTRAINT "ssh_host_identities_superseded_by_user_id_users_id_fk" FOREIGN KEY ("superseded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_host_identities_server_key_idx" ON "ssh_host_identities" USING btree ("server_id","algorithm","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_host_identities_active_server_idx" ON "ssh_host_identities" USING btree ("server_id") WHERE "ssh_host_identities"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "ssh_host_identities_team_idx" ON "ssh_host_identities" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ssh_host_identities_server_idx" ON "ssh_host_identities" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "ssh_host_identities_status_idx" ON "ssh_host_identities" USING btree ("status");