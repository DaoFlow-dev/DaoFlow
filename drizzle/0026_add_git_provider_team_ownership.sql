CREATE TABLE "git_provider_setup_states" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"provider_id" varchar(32),
	"provider_type" varchar(20) NOT NULL,
	"action" varchar(40) NOT NULL,
	"callback_origin" varchar(255) NOT NULL,
	"initiated_by_user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "git_providers_name_idx";--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "team_id" varchar(32);--> statement-breakpoint
ALTER TABLE "git_providers" ADD COLUMN "team_id" varchar(32);--> statement-breakpoint
ALTER TABLE "git_provider_setup_states" ADD CONSTRAINT "git_provider_setup_states_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_setup_states" ADD CONSTRAINT "git_provider_setup_states_provider_id_git_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."git_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_provider_setup_states_team_id_idx" ON "git_provider_setup_states" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "git_provider_setup_states_provider_id_idx" ON "git_provider_setup_states" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "git_provider_setup_states_expires_at_idx" ON "git_provider_setup_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "git_provider_setup_states_initiated_by_user_id_idx" ON "git_provider_setup_states" USING btree ("initiated_by_user_id");--> statement-breakpoint
ALTER TABLE "git_installations" ADD CONSTRAINT "git_installations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_providers" ADD CONSTRAINT "git_providers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_installations_team_id_idx" ON "git_installations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_installations_id_team_id_idx" ON "git_installations" USING btree ("id","team_id");--> statement-breakpoint
CREATE INDEX "git_providers_team_id_idx" ON "git_providers" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_providers_name_team_idx" ON "git_providers" USING btree ("name","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_providers_id_team_id_idx" ON "git_providers" USING btree ("id","team_id");