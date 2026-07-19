CREATE SEQUENCE "public"."environment_variable_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "project_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"key" varchar(80) NOT NULL,
	"value_encrypted" text NOT NULL,
	"is_secret" varchar(5) DEFAULT 'false' NOT NULL,
	"category" varchar(20) DEFAULT 'runtime' NOT NULL,
	"source" varchar(20) DEFAULT 'inline' NOT NULL,
	"secret_ref" text,
	"revision" integer DEFAULT nextval('environment_variable_revision_seq') NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD COLUMN "revision" integer DEFAULT nextval('environment_variable_revision_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "service_variables" ADD COLUMN "revision" integer DEFAULT nextval('environment_variable_revision_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_vars_project_id_idx" ON "project_variables" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_vars_project_key_idx" ON "project_variables" USING btree ("project_id","key");