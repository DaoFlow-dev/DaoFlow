ALTER TABLE "deployments" ADD COLUMN "service_id" varchar(32);--> statement-breakpoint
CREATE INDEX "deployments_service_id_idx" ON "deployments" USING btree ("service_id");