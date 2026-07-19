ALTER TABLE "deployments" ADD COLUMN "webhook_delivery_id" varchar(32);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "webhook_target_key" varchar(80);--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_webhook_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("webhook_delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_webhook_delivery_target_idx" ON "deployments" USING btree ("webhook_delivery_id","webhook_target_key");