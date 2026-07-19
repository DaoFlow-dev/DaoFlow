CREATE TABLE "server_metric_alerts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"metric_key" varchar(30) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"transition_type" varchar(20) NOT NULL,
	"previous_state" varchar(20) NOT NULL,
	"next_state" varchar(20) NOT NULL,
	"measured_value" double precision,
	"threshold_value" double precision,
	"occurred_at" timestamp NOT NULL,
	"notified_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "server_metric_delivery_cooldowns" (
	"server_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"metric_key" varchar(30) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"last_delivered_at" timestamp,
	"delivery_lease_token" varchar(32),
	"delivery_lease_expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_metric_delivery_cooldowns_pkey" PRIMARY KEY("server_id","channel_id","metric_key","event_type")
);
--> statement-breakpoint
CREATE TABLE "server_metric_outbox" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"alert_id" varchar(32) NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"metric_key" varchar(30) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp NOT NULL,
	"lease_owner" varchar(32),
	"lease_token" varchar(32),
	"lease_expires_at" timestamp,
	"last_error" text,
	"suppressed_at" timestamp,
	"sent_at" timestamp,
	"terminal_failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_metric_outbox_attempt_count_check" CHECK ("server_metric_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "server_metric_policies" (
	"server_id" varchar(32) PRIMARY KEY NOT NULL,
	"sample_interval_seconds" integer DEFAULT 60 NOT NULL,
	"retention_days" integer DEFAULT 7 NOT NULL,
	"cpu_warn_percent" integer DEFAULT 0 NOT NULL,
	"cpu_hard_percent" integer DEFAULT 0 NOT NULL,
	"memory_warn_percent" integer DEFAULT 0 NOT NULL,
	"memory_hard_percent" integer DEFAULT 0 NOT NULL,
	"disk_warn_percent" integer DEFAULT 0 NOT NULL,
	"disk_hard_percent" integer DEFAULT 0 NOT NULL,
	"docker_disk_warn_percent" integer DEFAULT 0 NOT NULL,
	"docker_disk_hard_percent" integer DEFAULT 0 NOT NULL,
	"cooldown_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_metric_policies_sample_interval_check" CHECK ("server_metric_policies"."sample_interval_seconds" between 1 and 86400),
	CONSTRAINT "server_metric_policies_retention_check" CHECK ("server_metric_policies"."retention_days" between 1 and 3650),
	CONSTRAINT "server_metric_policies_cpu_thresholds_check" CHECK ("server_metric_policies"."cpu_warn_percent" between 0 and 100 and "server_metric_policies"."cpu_hard_percent" between 0 and 100 and ("server_metric_policies"."cpu_warn_percent" = 0 or "server_metric_policies"."cpu_hard_percent" = 0 or "server_metric_policies"."cpu_warn_percent" <= "server_metric_policies"."cpu_hard_percent")),
	CONSTRAINT "server_metric_policies_memory_thresholds_check" CHECK ("server_metric_policies"."memory_warn_percent" between 0 and 100 and "server_metric_policies"."memory_hard_percent" between 0 and 100 and ("server_metric_policies"."memory_warn_percent" = 0 or "server_metric_policies"."memory_hard_percent" = 0 or "server_metric_policies"."memory_warn_percent" <= "server_metric_policies"."memory_hard_percent")),
	CONSTRAINT "server_metric_policies_disk_thresholds_check" CHECK ("server_metric_policies"."disk_warn_percent" between 0 and 100 and "server_metric_policies"."disk_hard_percent" between 0 and 100 and ("server_metric_policies"."disk_warn_percent" = 0 or "server_metric_policies"."disk_hard_percent" = 0 or "server_metric_policies"."disk_warn_percent" <= "server_metric_policies"."disk_hard_percent")),
	CONSTRAINT "server_metric_policies_docker_disk_thresholds_check" CHECK ("server_metric_policies"."docker_disk_warn_percent" between 0 and 100 and "server_metric_policies"."docker_disk_hard_percent" between 0 and 100 and ("server_metric_policies"."docker_disk_warn_percent" = 0 or "server_metric_policies"."docker_disk_hard_percent" = 0 or "server_metric_policies"."docker_disk_warn_percent" <= "server_metric_policies"."docker_disk_hard_percent")),
	CONSTRAINT "server_metric_policies_cooldown_check" CHECK ("server_metric_policies"."cooldown_minutes" between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE "server_metric_states" (
	"server_id" varchar(32) PRIMARY KEY NOT NULL,
	"current_state" varchar(20) DEFAULT 'healthy' NOT NULL,
	"metric_states" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp,
	"last_collected_at" timestamp,
	"last_unreachable_at" timestamp,
	"last_transition_at" timestamp,
	"last_alert_at" timestamp,
	"collection_generation" integer DEFAULT 0 NOT NULL,
	"collection_lease_owner" varchar(32),
	"collection_lease_token" varchar(32),
	"collection_lease_expires_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
	team_count integer;
BEGIN
	LOCK TABLE notification_channels, teams IN SHARE ROW EXCLUSIVE MODE;
	SELECT count(*) INTO team_count FROM teams;

	IF team_count = 0 AND EXISTS (SELECT 1 FROM notification_channels) THEN
		RAISE EXCEPTION USING
			MESSAGE = 'Cannot assign team ownership to existing notification channels because no teams exist.',
			HINT = 'Create the real owning team first, then rerun migration 0038. Do not use a placeholder or default team.';
	END IF;

	IF team_count > 1 AND EXISTS (SELECT 1 FROM notification_channels) THEN
		RAISE EXCEPTION USING
			MESSAGE = 'Cannot safely assign team ownership to existing notification channels because more than one team exists.',
			HINT = 'Run an approved data migration that maps every notification channel ID to its real owning team, then rerun migration 0038. Do not assign a shared default team.';
	END IF;

	ALTER TABLE notification_channels ADD COLUMN team_id varchar(32);

	IF team_count = 1 THEN
		UPDATE notification_channels SET team_id = (SELECT id FROM teams LIMIT 1);
	END IF;

	ALTER TABLE notification_channels ALTER COLUMN team_id SET NOT NULL;
	ALTER TABLE notification_channels
		ADD CONSTRAINT notification_channels_team_id_teams_id_fk
		FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
	CREATE INDEX notification_channels_team_id_idx
		ON notification_channels USING btree (team_id);
END
$$;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD COLUMN "docker_disk_used_percent" double precision;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD COLUMN "docker_disk_total_gb" double precision;--> statement-breakpoint
ALTER TABLE "server_metric_alerts" ADD CONSTRAINT "server_metric_alerts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_delivery_cooldowns" ADD CONSTRAINT "server_metric_delivery_cooldowns_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_delivery_cooldowns" ADD CONSTRAINT "server_metric_delivery_cooldowns_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_outbox" ADD CONSTRAINT "server_metric_outbox_alert_id_server_metric_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."server_metric_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_outbox" ADD CONSTRAINT "server_metric_outbox_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_outbox" ADD CONSTRAINT "server_metric_outbox_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_policies" ADD CONSTRAINT "server_metric_policies_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_states" ADD CONSTRAINT "server_metric_states_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_metric_alerts_server_occurred_idx" ON "server_metric_alerts" USING btree ("server_id","occurred_at");--> statement-breakpoint
CREATE INDEX "server_metric_alerts_occurred_idx" ON "server_metric_alerts" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "server_metric_delivery_cooldowns_lease_idx" ON "server_metric_delivery_cooldowns" USING btree ("delivery_lease_expires_at");--> statement-breakpoint
CREATE INDEX "server_metric_outbox_ready_idx" ON "server_metric_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "server_metric_outbox_server_event_idx" ON "server_metric_outbox" USING btree ("server_id","metric_key","event_type");--> statement-breakpoint
CREATE INDEX "server_metric_outbox_channel_idx" ON "server_metric_outbox" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "server_metric_states_current_state_idx" ON "server_metric_states" USING btree ("current_state");--> statement-breakpoint
CREATE INDEX "server_metric_states_collection_lease_idx" ON "server_metric_states" USING btree ("collection_lease_expires_at");--> statement-breakpoint
CREATE INDEX "server_metrics_server_collected_idx" ON "server_metrics" USING btree ("server_id","collected_at");
