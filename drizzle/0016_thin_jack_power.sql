ALTER TABLE "servers" ADD COLUMN "team_id" varchar(32);--> statement-breakpoint
UPDATE "servers"
SET "team_id" = COALESCE(
  (SELECT "default_team_id" FROM "users" WHERE "users"."id" = "servers"."registered_by_user_id"),
  (SELECT "team_id" FROM "team_members" WHERE "team_members"."user_id" = "servers"."registered_by_user_id" ORDER BY "created_at" LIMIT 1),
  (SELECT "id" FROM "teams" ORDER BY "created_at" LIMIT 1)
)
WHERE "team_id" IS NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "servers_team_id_idx" ON "servers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "servers_ssh_key_id_idx" ON "servers" USING btree ("ssh_key_id");
