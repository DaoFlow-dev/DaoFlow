CREATE TABLE "external_backup_artifacts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"destination_id" varchar(32) NOT NULL,
	"object_key" text NOT NULL,
	"object_version" text,
	"object_etag" varchar(512),
	"size_bytes" text NOT NULL,
	"content_type" varchar(255),
	"last_modified" timestamp,
	"sha256" varchar(64),
	"archive_format" varchar(32) DEFAULT 'postgres-custom' NOT NULL,
	"listing_evidence" text,
	"source_postgres_version" varchar(64) NOT NULL,
	"verifier_image" text,
	"status" varchar(20) DEFAULT 'registering' NOT NULL,
	"register_error" text,
	"registered_by_user_id" varchar(32),
	"registered_at" timestamp,
	"verified_at" timestamp,
	"latest_verification" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_backup_artifacts_identity_check" CHECK ("external_backup_artifacts"."object_version" IS NOT NULL OR "external_backup_artifacts"."object_etag" IS NOT NULL),
	CONSTRAINT "external_backup_artifacts_size_check" CHECK ("external_backup_artifacts"."size_bytes" ~ '^[0-9]+$' AND "external_backup_artifacts"."size_bytes"::numeric BETWEEN 1 AND 2147483648),
	CONSTRAINT "external_backup_artifacts_archive_format_check" CHECK ("external_backup_artifacts"."archive_format" = 'postgres-custom'),
	CONSTRAINT "external_backup_artifacts_source_version_check" CHECK ("external_backup_artifacts"."source_postgres_version" ~ '^[1-9][0-9]*(\.[0-9]+){0,2}$'),
	CONSTRAINT "external_backup_artifacts_sha256_check" CHECK ("external_backup_artifacts"."sha256" IS NULL OR "external_backup_artifacts"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "external_backup_artifacts_status_check" CHECK ("external_backup_artifacts"."status" IN ('registering', 'registered', 'verifying', 'verified', 'failed')),
	CONSTRAINT "external_backup_artifacts_registered_metadata_check" CHECK ((
        "external_backup_artifacts"."status" IN ('registering', 'failed')
        OR (
          "external_backup_artifacts"."sha256" IS NOT NULL
          AND "external_backup_artifacts"."listing_evidence" IS NOT NULL
          AND "external_backup_artifacts"."verifier_image" IS NOT NULL
          AND "external_backup_artifacts"."registered_at" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "backup_restores" ALTER COLUMN "backup_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD COLUMN "external_artifact_id" varchar(32);--> statement-breakpoint
ALTER TABLE "backup_restores" ADD COLUMN "target_volume_id" varchar(32);--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "external_import_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "external_import_prefix" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "max_external_import_bytes" text DEFAULT '2147483648' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_backup_artifacts" ADD CONSTRAINT "external_backup_artifacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_backup_artifacts" ADD CONSTRAINT "external_backup_artifacts_destination_id_backup_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."backup_destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_backup_artifacts" ADD CONSTRAINT "external_backup_artifacts_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_backup_artifacts_team_created_idx" ON "external_backup_artifacts" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "external_backup_artifacts_destination_created_idx" ON "external_backup_artifacts" USING btree ("destination_id","created_at");--> statement-breakpoint
CREATE INDEX "external_backup_artifacts_status_idx" ON "external_backup_artifacts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_backup_artifacts_version_identity_uq" ON "external_backup_artifacts" USING btree ("destination_id","object_key","object_version") WHERE "external_backup_artifacts"."object_version" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_backup_artifacts_etag_identity_uq" ON "external_backup_artifacts" USING btree ("destination_id","object_key","object_etag") WHERE "external_backup_artifacts"."object_version" IS NULL;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_external_artifact_id_external_backup_artifacts_id_fk" FOREIGN KEY ("external_artifact_id") REFERENCES "public"."external_backup_artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_target_volume_id_volumes_id_fk" FOREIGN KEY ("target_volume_id") REFERENCES "public"."volumes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_restores_external_artifact_id_idx" ON "backup_restores" USING btree ("external_artifact_id");--> statement-breakpoint
CREATE INDEX "backup_restores_target_volume_id_idx" ON "backup_restores" USING btree ("target_volume_id");--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_source_xor_check" CHECK ((
        ("backup_restores"."backup_run_id" IS NOT NULL AND "backup_restores"."external_artifact_id" IS NULL)
        OR ("backup_restores"."backup_run_id" IS NULL AND "backup_restores"."external_artifact_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_external_target_mode_check" CHECK ((
        ("backup_restores"."backup_run_id" IS NOT NULL AND "backup_restores"."target_volume_id" IS NULL)
        OR (
          "backup_restores"."external_artifact_id" IS NOT NULL
          AND (
            ("backup_restores"."mode" = 'verification' AND "backup_restores"."target_volume_id" IS NULL)
            OR ("backup_restores"."mode" = 'restore' AND "backup_restores"."target_volume_id" IS NOT NULL)
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_external_import_settings_check" CHECK ((
        "backup_destinations"."max_external_import_bytes" ~ '^[0-9]+$'
        AND "backup_destinations"."max_external_import_bytes"::numeric BETWEEN 1048576 AND 2147483648
        AND (
          "backup_destinations"."external_import_enabled" = false
          OR (
            "backup_destinations"."provider" = 's3'
            AND "backup_destinations"."encryption_mode" = 'none'
            AND "backup_destinations"."external_import_prefix" IS NOT NULL
            AND char_length(btrim("backup_destinations"."external_import_prefix")) > 0
            AND "backup_destinations"."external_import_prefix" = btrim("backup_destinations"."external_import_prefix")
            AND "backup_destinations"."external_import_prefix" !~ '(^/|//|(^|/)\.\.?(/|$)|\\)'
          )
        )
      ));