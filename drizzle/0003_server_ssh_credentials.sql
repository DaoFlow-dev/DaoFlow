ALTER TABLE "servers" ADD COLUMN "ssh_user" varchar(80);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "ssh_private_key_encrypted" text;