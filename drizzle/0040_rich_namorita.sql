CREATE TABLE "provider_feedback_preview_comments" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"provider_id" varchar(32) NOT NULL,
	"repository_full_name" varchar(255) NOT NULL,
	"pull_request_number" integer NOT NULL,
	"external_comment_id" varchar(255),
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_feedback_preview_comments" ADD CONSTRAINT "provider_feedback_preview_comments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback_preview_comments" ADD CONSTRAINT "provider_feedback_preview_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_feedback_preview_comments_identity_idx" ON "provider_feedback_preview_comments" USING btree ("project_id","repository_full_name","pull_request_number");--> statement-breakpoint
CREATE INDEX "provider_feedback_preview_comments_team_id_idx" ON "provider_feedback_preview_comments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "provider_feedback_preview_comments_lease_expires_at_idx" ON "provider_feedback_preview_comments" USING btree ("lease_expires_at");