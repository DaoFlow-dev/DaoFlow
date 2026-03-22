CREATE TABLE "container_registries" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"registry_host" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"password_encrypted" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "container_registries_name_idx" ON "container_registries" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "container_registries_host_idx" ON "container_registries" USING btree ("registry_host");--> statement-breakpoint
CREATE INDEX "container_registries_created_at_idx" ON "container_registries" USING btree ("created_at");