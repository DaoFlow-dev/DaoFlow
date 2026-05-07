CREATE TABLE "certificate_assets" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"certificate_pem_encrypted" text NOT NULL,
	"private_key_encrypted" text,
	"ca_chain_encrypted" text,
	"fingerprint" varchar(120) NOT NULL,
	"subject" text,
	"issuer" text,
	"expires_at" timestamp,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_ssh_keys" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"username" varchar(80),
	"fingerprint" varchar(120) NOT NULL,
	"key_type" varchar(40) NOT NULL,
	"public_key" text,
	"private_key_encrypted" text NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"rotated_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ALTER COLUMN "ssh_key_id" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "certificate_assets" ADD CONSTRAINT "certificate_assets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_assets" ADD CONSTRAINT "certificate_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ssh_keys" ADD CONSTRAINT "managed_ssh_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_ssh_keys" ADD CONSTRAINT "managed_ssh_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_assets_team_name_idx" ON "certificate_assets" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_assets_team_fingerprint_idx" ON "certificate_assets" USING btree ("team_id","fingerprint");--> statement-breakpoint
CREATE INDEX "certificate_assets_team_idx" ON "certificate_assets" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "certificate_assets_status_idx" ON "certificate_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "certificate_assets_expires_at_idx" ON "certificate_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_ssh_keys_team_name_idx" ON "managed_ssh_keys" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_ssh_keys_team_fingerprint_idx" ON "managed_ssh_keys" USING btree ("team_id","fingerprint");--> statement-breakpoint
CREATE INDEX "managed_ssh_keys_team_idx" ON "managed_ssh_keys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "managed_ssh_keys_status_idx" ON "managed_ssh_keys" USING btree ("status");--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_ssh_key_id_managed_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."managed_ssh_keys"("id") ON DELETE set null ON UPDATE no action;