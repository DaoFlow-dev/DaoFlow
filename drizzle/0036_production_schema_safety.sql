CREATE TABLE "deployment_build_leases" (
	"deployment_id" varchar(32) PRIMARY KEY NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"owner_token" varchar(64) NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_queue_reservations" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"server_id" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"delivery_id" varchar(32) NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"lease_owner" varchar(128) NOT NULL,
	"lease_expires_at" timestamp NOT NULL,
	"error_summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_targets" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"delivery_id" varchar(32) NOT NULL,
	"target_key" varchar(80) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_attempt_id" varchar(32),
	"detail" text,
	"error_summary" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "max_concurrent_builds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "max_queued_deployments" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "webhook_delivery_id" varchar(32);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "webhook_target_key" varchar(80);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "body_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "current_attempt_id" varchar(32);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error_summary" text;--> statement-breakpoint
ALTER TABLE "deployment_build_leases" ADD CONSTRAINT "deployment_build_leases_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_build_leases" ADD CONSTRAINT "deployment_build_leases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_queue_reservations" ADD CONSTRAINT "deployment_queue_reservations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_targets" ADD CONSTRAINT "webhook_delivery_targets_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_targets" ADD CONSTRAINT "webhook_delivery_targets_last_attempt_id_webhook_delivery_attempts_id_fk" FOREIGN KEY ("last_attempt_id") REFERENCES "public"."webhook_delivery_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_build_leases_server_id_idx" ON "deployment_build_leases" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "deployment_build_leases_server_expires_at_idx" ON "deployment_build_leases" USING btree ("server_id","expires_at");--> statement-breakpoint
CREATE INDEX "deployment_build_leases_expires_at_idx" ON "deployment_build_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "deployment_queue_reservations_server_id_idx" ON "deployment_queue_reservations" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "deployment_queue_reservations_server_expires_at_idx" ON "deployment_queue_reservations" USING btree ("server_id","expires_at");--> statement-breakpoint
CREATE INDEX "deployment_queue_reservations_expires_at_idx" ON "deployment_queue_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_attempts_delivery_number_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_status_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","status");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_lease_expiry_idx" ON "webhook_delivery_attempts" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_targets_delivery_key_idx" ON "webhook_delivery_targets" USING btree ("delivery_id","target_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_targets_retry_idx" ON "webhook_delivery_targets" USING btree ("delivery_id","status");--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_webhook_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("webhook_delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_webhook_delivery_target_idx" ON "deployments" USING btree ("webhook_delivery_id","webhook_target_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_recovery_status_seen_idx" ON "webhook_deliveries" USING btree ("status","last_seen_at");--> statement-breakpoint
-- custom-approval-team-ownership:start
-- Existing approvals need an owning team before the column can become required.
-- Unresolvable or ambiguous legacy rows are recorded in the audit trail and
-- quarantined instead of being assigned to an arbitrary default team.
DROP INDEX "approval_requests_pending_binding_idx";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "team_id" varchar(32);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_team_id_idx" ON "approval_requests" USING btree ("team_id");--> statement-breakpoint
WITH service_target_teams AS (
  SELECT
    approval_requests.id AS approval_request_id,
    projects.team_id
  FROM approval_requests
  INNER JOIN services
    ON services.id = split_part(approval_requests.target_resource, '/', 2)
  INNER JOIN projects ON projects.id = services.project_id
  WHERE split_part(approval_requests.target_resource, '/', 1) = 'service'
),
compose_target_candidates AS (
  SELECT
    approval_requests.id AS approval_request_id,
    projects.team_id
  FROM approval_requests
  INNER JOIN environments
    ON jsonb_typeof(environments.config->'composeServices') = 'array'
  CROSS JOIN LATERAL jsonb_array_elements(environments.config->'composeServices') AS compose_service
  INNER JOIN projects ON projects.id = environments.project_id
  WHERE split_part(approval_requests.target_resource, '/', 1) = 'compose-service'
    AND compose_service->>'id' = split_part(approval_requests.target_resource, '/', 2)
),
compose_target_teams AS (
  SELECT
    approval_request_id,
    min(team_id) AS team_id
  FROM compose_target_candidates
  GROUP BY approval_request_id
  HAVING count(DISTINCT team_id) = 1
),
backup_target_teams AS (
  SELECT
    approval_requests.id AS approval_request_id,
    CASE
      WHEN volumes.metadata->>'serviceId' IS NOT NULL
        AND service_projects.team_id = servers.team_id
        AND (
          volumes.metadata->>'projectId' IS NULL
          OR volumes.metadata->>'projectId' = volume_services.project_id
        )
        THEN servers.team_id
      WHEN volumes.metadata->>'serviceId' IS NULL
        AND volumes.metadata->>'projectId' IS NULL
        THEN servers.team_id
      WHEN volumes.metadata->>'serviceId' IS NULL
        AND volume_projects.team_id = servers.team_id
        THEN servers.team_id
      ELSE NULL
    END AS team_id
  FROM approval_requests
  INNER JOIN backup_runs
    ON backup_runs.id = split_part(approval_requests.target_resource, '/', 2)
  INNER JOIN backup_policies ON backup_policies.id = backup_runs.policy_id
  INNER JOIN volumes ON volumes.id = backup_policies.volume_id
  INNER JOIN servers ON servers.id = volumes.server_id
  LEFT JOIN services AS volume_services
    ON volume_services.id = volumes.metadata->>'serviceId'
  LEFT JOIN projects AS service_projects
    ON service_projects.id = volume_services.project_id
  LEFT JOIN projects AS volume_projects
    ON volume_projects.id = volumes.metadata->>'projectId'
  WHERE split_part(approval_requests.target_resource, '/', 1) = 'backup-run'
),
resolved_teams AS (
  SELECT approval_request_id, team_id FROM service_target_teams
  UNION ALL
  SELECT approval_request_id, team_id FROM compose_target_teams
  UNION ALL
  SELECT approval_request_id, team_id FROM backup_target_teams WHERE team_id IS NOT NULL
)
UPDATE approval_requests
SET team_id = resolved_teams.team_id
FROM resolved_teams
WHERE approval_requests.id = resolved_teams.approval_request_id;--> statement-breakpoint
INSERT INTO audit_entries (
  actor_type,
  actor_id,
  target_resource,
  action,
  input_summary,
  permission_scope,
  outcome,
  metadata,
  created_at
)
SELECT
  'system',
  'migration-0036',
  'approval-request/' || approval_requests.id,
  'approval.quarantine',
  'Quarantined an approval whose owning team could not be derived from its target.',
  'policy:override',
  'failure',
  jsonb_build_object(
    'approvalRequestId', approval_requests.id,
    'actionType', approval_requests.action_type,
    'targetResource', approval_requests.target_resource,
    'previousStatus', approval_requests.status,
    'reason', 'unresolved-team-ownership'
  ),
  now()
FROM approval_requests
WHERE team_id IS NULL;--> statement-breakpoint
DELETE FROM approval_requests
WHERE team_id IS NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_binding_idx" ON "approval_requests" USING btree ("team_id","binding_key") WHERE "approval_requests"."binding_key" is not null and "approval_requests"."status" = 'pending';
-- custom-approval-team-ownership:end
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_max_concurrent_builds_check" CHECK ("servers"."max_concurrent_builds" between 1 and 20);--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_max_queued_deployments_check" CHECK ("servers"."max_queued_deployments" between 1 and 500);
