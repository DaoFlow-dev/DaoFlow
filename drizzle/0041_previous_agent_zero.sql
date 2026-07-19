ALTER TABLE "git_installations" ADD COLUMN "credential_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "credential_scopes" text;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "credential_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "credential_encrypted" text;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "credential_envelope_version" integer;--> statement-breakpoint
ALTER TABLE "git_installations" ADD COLUMN "credential_key_id" varchar(64);--> statement-breakpoint
ALTER TABLE "git_provider_setup_states" ADD COLUMN "provider_public_base_url" varchar(255);--> statement-breakpoint
ALTER TABLE "git_provider_setup_states" ADD COLUMN "code_verifier_encrypted" text;--> statement-breakpoint
ALTER TABLE "git_providers" ADD COLUMN "internal_base_url" varchar(255);