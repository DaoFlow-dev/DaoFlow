ALTER TABLE "backup_destinations" ADD COLUMN "credentials_encrypted" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "credential_envelope_version" integer;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "credential_key_id" varchar(64);--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_credentials_state_check" CHECK ((
        (
          "backup_destinations"."credentials_encrypted" IS NULL
          AND "backup_destinations"."credential_envelope_version" IS NULL
          AND "backup_destinations"."credential_key_id" IS NULL
          AND "backup_destinations"."access_key" IS NULL
          AND "backup_destinations"."secret_access_key" IS NULL
          AND "backup_destinations"."oauth_token" IS NULL
          AND "backup_destinations"."rclone_config" IS NULL
          AND "backup_destinations"."encryption_password" IS NULL
          AND "backup_destinations"."encryption_salt" IS NULL
        )
        OR
        (
          "backup_destinations"."credentials_encrypted" IS NOT NULL
          AND "backup_destinations"."credential_envelope_version" IS NOT NULL
          AND "backup_destinations"."credential_key_id" IS NOT NULL
          AND "backup_destinations"."access_key" IS NULL
          AND "backup_destinations"."secret_access_key" IS NULL
          AND "backup_destinations"."oauth_token" IS NULL
          AND "backup_destinations"."rclone_config" IS NULL
          AND "backup_destinations"."encryption_password" IS NULL
          AND "backup_destinations"."encryption_salt" IS NULL
        )
      )) NOT VALID;
