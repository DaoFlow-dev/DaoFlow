CREATE TABLE "service_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" varchar(32) NOT NULL,
	"key" varchar(80) NOT NULL,
	"value_encrypted" text NOT NULL,
	"is_secret" varchar(5) DEFAULT 'false' NOT NULL,
	"category" varchar(20) DEFAULT 'runtime' NOT NULL,
	"source" varchar(20) DEFAULT 'inline' NOT NULL,
	"secret_ref" text,
	"branch_pattern" varchar(120) DEFAULT '' NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "env_vars_env_key_idx";--> statement-breakpoint
UPDATE "environment_variables" SET "branch_pattern" = '' WHERE "branch_pattern" IS NULL;--> statement-breakpoint
ALTER TABLE "environment_variables" ALTER COLUMN "branch_pattern" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "environment_variables" ALTER COLUMN "branch_pattern" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "service_variables" ADD CONSTRAINT "service_variables_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variables" ADD CONSTRAINT "service_variables_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_vars_service_id_idx" ON "service_variables" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_vars_service_key_branch_idx" ON "service_variables" USING btree ("service_id","key","branch_pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_env_key_branch_idx" ON "environment_variables" USING btree ("environment_id","key","branch_pattern");
