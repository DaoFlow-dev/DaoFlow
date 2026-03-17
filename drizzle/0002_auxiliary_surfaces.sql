CREATE TABLE "tunnel_routes" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"tunnel_id" varchar(32) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"service" varchar(255) NOT NULL,
	"path" varchar(255),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnels" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"tunnel_id" varchar(80),
	"credentials_encrypted" text,
	"domain" varchar(255),
	"status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"webhook_url" text,
	"email" text,
	"event_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"project_filter" varchar(100),
	"environment_filter" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"http_status" varchar(5),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_notification_overrides" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"project_id" varchar(32) NOT NULL,
	"user_id" text,
	"channel_type" varchar(20) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_pushed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_providers" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"config_encrypted" text NOT NULL,
	"team_id" varchar(32) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_tested_at" timestamp,
	"created_by_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tunnel_routes" ADD CONSTRAINT "tunnel_routes_tunnel_id_tunnels_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "public"."tunnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_providers" ADD CONSTRAINT "secret_providers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_providers" ADD CONSTRAINT "secret_providers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tunnel_routes_tunnel_id_idx" ON "tunnel_routes" USING btree ("tunnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnel_routes_hostname_idx" ON "tunnel_routes" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnels_name_team_idx" ON "tunnels" USING btree ("name","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnels_tunnel_id_idx" ON "tunnels" USING btree ("tunnel_id");--> statement-breakpoint
CREATE INDEX "notification_channels_type_idx" ON "notification_channels" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "notification_channels_enabled_idx" ON "notification_channels" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "notification_logs_channel_id_idx" ON "notification_logs" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notification_logs_event_type_idx" ON "notification_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notification_logs_sent_at_idx" ON "notification_logs" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "project_notification_overrides_project_id_idx" ON "project_notification_overrides" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_notification_overrides_user_id_idx" ON "project_notification_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "user_notification_prefs_user_id_idx" ON "user_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_notification_prefs_channel_type_idx" ON "user_notification_preferences" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "secret_providers_team_id_idx" ON "secret_providers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "secret_providers_type_idx" ON "secret_providers" USING btree ("type");