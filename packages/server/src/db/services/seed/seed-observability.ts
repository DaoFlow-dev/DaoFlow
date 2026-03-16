import type { PgTransaction } from "drizzle-orm/pg-core";
import { backupPolicies, backupRuns, backupRestores } from "../../schema/storage";
import { auditEntries, events, approvalRequests } from "../../schema/audit";
import { daysBefore, hoursBefore, minutesBefore, hoursAfter } from "./seed-helpers";

export async function seedObservability(tx: PgTransaction<any, any, any>) {
  await tx
    .insert(backupPolicies)
    .values([
      {
        id: "bpol_foundation_volume_daily",
        name: "postgres-volume",
        volumeId: "pvol_daoflow_postgres_prod",
        schedule: "Daily at 02:00 UTC",
        retentionDays: 14,
        storageTarget: "s3://daoflow-backups/prod",
        status: "active",
        createdAt: daysBefore(12),
        updatedAt: daysBefore(1)
      },
      {
        id: "bpol_foundation_db_hourly",
        name: "control-plane-db",
        volumeId: "pvol_daoflow_postgres_prod",
        schedule: "Hourly",
        retentionDays: 48,
        storageTarget: "s3://daoflow-backups/staging",
        status: "active",
        createdAt: daysBefore(11),
        updatedAt: hoursBefore(1)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(backupRuns)
    .values([
      {
        id: "brun_foundation_volume_success",
        policyId: "bpol_foundation_volume_daily",
        status: "succeeded",
        artifactPath: "s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst",
        sizeBytes: "73400320",
        triggeredByUserId: null,
        error: null,
        startedAt: daysBefore(1),
        completedAt: new Date(daysBefore(1).getTime() + 5 * 60 * 1000),
        createdAt: daysBefore(1)
      },
      {
        id: "brun_foundation_db_failed",
        policyId: "bpol_foundation_db_hourly",
        status: "failed",
        artifactPath: null,
        sizeBytes: null,
        triggeredByUserId: null,
        error: "pg_dump lost the SSH transport before the archive uploaded.",
        startedAt: hoursBefore(1),
        completedAt: new Date(hoursBefore(1).getTime() + 7 * 60 * 1000),
        createdAt: hoursBefore(1)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(backupRestores)
    .values({
      id: "brestore_vol_verify",
      backupRunId: "brun_foundation_volume_success",
      status: "succeeded",
      targetPath: "/var/lib/postgresql/data",
      triggeredByUserId: "user_foundation_operator",
      error: "Restore drill replayed the volume snapshot and passed the smoke query check.",
      startedAt: new Date(daysBefore(2).getTime() - 20 * 60 * 1000),
      completedAt: daysBefore(2),
      createdAt: new Date(daysBefore(2).getTime() - 20 * 60 * 1000)
    })
    .onConflictDoNothing();

  await tx
    .insert(auditEntries)
    .values([
      {
        id: 4001,
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: "deployment/dep_foundation_20260312_1",
        action: "deployment.create",
        inputSummary: "Queued the seeded control-plane rollout for production-us-west.",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: {
          seedId: "audit_foundation_deployment_create",
          resourceType: "deployment",
          resourceId: "dep_foundation_20260312_1",
          resourceLabel: "control-plane@production-us-west",
          detail: "Queued the seeded control-plane rollout for production-us-west."
        },
        createdAt: minutesBefore(7)
      },
      {
        id: 4002,
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: "execution-job/job_foundation_20260312_1",
        action: "execution.complete",
        inputSummary: "Marked the seeded production rollout healthy after worker completion.",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: {
          seedId: "audit_foundation_execution_complete",
          resourceType: "execution-job",
          resourceId: "job_foundation_20260312_1",
          resourceLabel: "control-plane@production-us-west",
          detail: "Marked the seeded production rollout healthy after worker completion."
        },
        createdAt: minutesBefore(1.5)
      },
      {
        id: 4003,
        actorType: "system",
        actorId: "scheduler",
        actorEmail: null,
        actorRole: null,
        organizationId: "team_foundation",
        targetResource: "backup-run/brun_foundation_volume_success",
        action: "backup.schedule",
        inputSummary:
          "Recorded the scheduled volume backup snapshot for the production database volume.",
        permissionScope: "backup:run",
        outcome: "success",
        metadata: {
          seedId: "audit_foundation_backup_schedule",
          resourceType: "backup-run",
          resourceId: "brun_foundation_volume_success",
          resourceLabel: "postgres-volume@production-us-west",
          detail:
            "Recorded the scheduled volume backup snapshot for the production database volume."
        },
        createdAt: new Date(daysBefore(1).getTime() + 5 * 60 * 1000)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(events)
    .values([
      {
        id: 5001,
        kind: "execution.job.created",
        resourceType: "deployment",
        resourceId: "dep_foundation_20260312_1",
        summary: "Prepared SSH-backed execution handoff.",
        detail: "The deployment was packaged for the docker-ssh worker queue.",
        severity: "info",
        metadata: { serviceName: "control-plane", actorLabel: "control-plane" },
        createdAt: minutesBefore(7)
      },
      {
        id: 5002,
        kind: "deployment.succeeded",
        resourceType: "deployment",
        resourceId: "dep_foundation_20260312_1",
        summary: "Deployment finished healthy.",
        detail: "The control-plane rollout completed and passed health checks.",
        severity: "info",
        metadata: { serviceName: "control-plane", actorLabel: "docker-ssh-worker" },
        createdAt: minutesBefore(1.5)
      },
      {
        id: 5003,
        kind: "execution.job.created",
        resourceType: "deployment",
        resourceId: "dep_foundation_20260311_1",
        summary: "Prepared retryable worker job.",
        detail: "The failed release candidate was handed off to the docker-ssh queue.",
        severity: "info",
        metadata: { serviceName: "control-plane", actorLabel: "control-plane" },
        createdAt: minutesBefore(70)
      },
      {
        id: 5004,
        kind: "deployment.failed",
        resourceType: "deployment",
        resourceId: "dep_foundation_20260311_1",
        summary: "Deployment failed readiness checks.",
        detail: "The new container restarted twice and did not become healthy.",
        severity: "error",
        metadata: { serviceName: "control-plane", actorLabel: "docker-ssh-worker" },
        createdAt: minutesBefore(66)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(approvalRequests)
    .values({
      id: "approval_restore_prod_guard",
      actionType: "backup-restore",
      targetResource: "backup-run/brun_foundation_volume_success",
      reason: "Need operator confirmation before replaying a production volume snapshot.",
      status: "pending",
      requestedByUserId: "user_planner_agent",
      requestedByEmail: "planner-agent@daoflow.local",
      requestedByRole: "agent",
      resolvedByUserId: null,
      resolvedByEmail: null,
      inputSummary: {
        riskLevel: "critical",
        resourceLabel: "postgres-volume@production-us-west",
        commandSummary:
          "Restore s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst to foundation-vps-1:/var/lib/postgresql/data.",
        recommendedChecks: [
          "Confirm the target volume is isolated from live writes before replaying snapshot data.",
          "Verify the latest successful backup artifact still matches the registered volume mount path."
        ],
        requestedAt: minutesBefore(55).toISOString(),
        expiresAt: hoursAfter(7).toISOString(),
        targetType: "volume",
        serviceName: "postgres-volume",
        environmentName: "production-us-west"
      },
      createdAt: minutesBefore(55),
      resolvedAt: null
    })
    .onConflictDoNothing();
}
