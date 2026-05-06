CREATE TABLE "repository_credentials" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"username_encrypted" text,
	"password_encrypted" text,
	"token_encrypted" text,
	"private_key_encrypted" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_credentials" ADD CONSTRAINT "repository_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_credentials_project_idx" ON "repository_credentials" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "repository_credentials_project_status_idx" ON "repository_credentials" USING btree ("project_id","status");