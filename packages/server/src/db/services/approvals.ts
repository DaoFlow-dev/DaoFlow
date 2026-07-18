import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { queueBackupRestore } from "./backups";
import { listComposeReleaseCatalog } from "./compose";
import { approvalRequests, auditEntries, events } from "../schema/audit";
import { services } from "../schema/services";
import { environments, projects } from "../schema/projects";
import { backupPolicies, backupRuns, volumes } from "../schema/storage";
import type { AppRole } from "@daoflow/shared";
import { newId as id, asRecord, readString, readStringArray } from "./json-helpers";
import { buildApprovalNotification } from "../../worker/temporal/activities/notification-builders";
import { dispatchNotification } from "../../worker/temporal/activities/notification-activities";
import {
  buildPreviewApprovalBindingKey,
  readPreviewApprovalBinding,
  readPreviewApprovalExpiry,
  type PreviewApprovalBinding
} from "../../preview-trust";
import { triggerDeploy } from "./trigger-deploy";
import { resolveVolumeTeamId } from "./backup-resource-team";

export type ApprovalActionType = "compose-release" | "backup-restore" | "preview-deployment";

type ApprovalRequester = {
  teamId: string;
  requestedByUserId: string | null;
  requestedByEmail: string;
  requestedByRole: AppRole;
};

export type CreateApprovalRequestInput =
  | ({
      actionType: "compose-release";
      composeServiceId: string;
      commitSha: string;
      imageTag?: string | null;
      reason: string;
    } & ApprovalRequester)
  | ({
      actionType: "backup-restore";
      backupRunId: string;
      reason: string;
    } & ApprovalRequester)
  | ({
      actionType: "preview-deployment";
      serviceId: string;
      previewTrust: PreviewApprovalBinding;
      reason: string;
    } & ApprovalRequester);

function getApprovalStatusTone(status: string, riskLevel: "medium" | "elevated" | "critical") {
  if (status === "approved") {
    return "healthy" as const;
  }

  if (status === "rejected") {
    return "failed" as const;
  }

  if (status === "expired") {
    return "failed" as const;
  }

  return riskLevel === "critical" ? "failed" : ("running" as const);
}

async function resolveApprovalPresentation(input: CreateApprovalRequestInput) {
  if (input.actionType === "compose-release") {
    const catalog = await listComposeReleaseCatalog(100, input.teamId);
    const service = catalog.services.find((candidate) => candidate.id === input.composeServiceId);
    if (!service) return null;
    const [target] = await db
      .select({ teamId: projects.teamId })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(and(eq(environments.id, service.environmentId), eq(projects.teamId, input.teamId)))
      .limit(1);
    if (!target) return null;

    return {
      teamId: target.teamId,
      targetResource: `compose-service/${input.composeServiceId}`,
      resourceLabel: `${service.serviceName}@${service.environmentName}`,
      riskLevel: "elevated",
      commandSummary: `Release ${input.imageTag ?? service.imageReference} for ${service.serviceName} on ${service.targetServerName} using commit ${input.commitSha}.`,
      recommendedChecks: [
        "Confirm the target service dependencies are healthy before dispatching the release.",
        "Verify the Compose diff still matches the intended release track."
      ],
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    } as const;
  }

  if (input.actionType === "preview-deployment") {
    const [row] = await db
      .select({ service: services, teamId: projects.teamId })
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
      .limit(1);
    const service = row?.service;
    if (!service || service.projectId === null || input.previewTrust.serviceId !== service.id) {
      return null;
    }

    const preview = input.previewTrust.preview;
    if (preview.target !== "pull-request" || preview.action !== "deploy") {
      return null;
    }

    return {
      teamId: row.teamId,
      targetResource: `service/${service.id}`,
      resourceLabel: `${service.name} · PR #${preview.pullRequestNumber} @${input.previewTrust.commitSha.slice(0, 12)}`,
      riskLevel: "critical",
      commandSummary: `Deploy the approved ${input.previewTrust.providerType} commit ${input.previewTrust.commitSha} from ${input.previewTrust.sourceRepository}.`,
      recommendedChecks: [
        "Confirm the commit and source repository match the pull request you reviewed.",
        "Approve only when the project preview policy and target environment are still intended."
      ],
      expiresAt: input.previewTrust.expiresAt,
      previewTrust: input.previewTrust
    } as const;
  }

  const [run] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.id, input.backupRunId))
    .limit(1);
  if (!run) return null;

  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, run.policyId))
    .limit(1);
  if (!policy) return null;
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);
  if (!volume) return null;
  const teamId = await resolveVolumeTeamId(volume);
  if (!teamId || teamId !== input.teamId) return null;

  const serviceName =
    policy.id === "bpol_foundation_volume_daily" ? "postgres-volume" : policy.name;
  const environmentName =
    policy.id === "bpol_foundation_volume_daily" ? "production-us-west" : "staging";
  const destination = "foundation-vps-1:/var/lib/postgresql/data";

  return {
    teamId,
    targetResource: `backup-run/${input.backupRunId}`,
    resourceLabel: `${serviceName}@${environmentName}`,
    riskLevel: "critical",
    commandSummary: `Restore ${run.artifactPath ?? "the backup artifact"} to ${destination}.`,
    recommendedChecks: [
      "Confirm the target volume is isolated from live writes before replaying snapshot data.",
      "Verify the latest successful backup artifact still matches the registered volume mount path."
    ],
    expiresAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()
  } as const;
}

function enrichApproval(request: typeof approvalRequests.$inferSelect) {
  const { bindingKey: _bindingKey, ...publicRequest } = request;
  void _bindingKey;
  const summary = asRecord(request.inputSummary);
  const riskLevel = readString(summary, "riskLevel", "medium") as
    "medium" | "elevated" | "critical";
  return {
    ...publicRequest,
    requestedBy: request.requestedByEmail ?? "",
    resourceLabel: readString(summary, "resourceLabel", request.targetResource),
    riskLevel,
    statusTone: getApprovalStatusTone(request.status, riskLevel),
    commandSummary: readString(summary, "commandSummary", request.reason ?? ""),
    requestedAt: readString(summary, "requestedAt", request.createdAt.toISOString()),
    expiresAt: readString(summary, "expiresAt", ""),
    decidedBy: request.resolvedByEmail ?? null,
    decidedAt: request.resolvedAt?.toISOString() ?? null,
    recommendedChecks: readStringArray(summary, "recommendedChecks"),
    previewTrust: readPreviewApprovalBinding(summary.previewTrust),
    createdAt: request.createdAt.toISOString()
  };
}

export async function createApprovalRequest(input: CreateApprovalRequestInput) {
  const presentation = await resolveApprovalPresentation(input);
  if (!presentation) return null;

  const requestId = id();
  const createdAt = new Date();
  const bindingKey =
    input.actionType === "preview-deployment"
      ? buildPreviewApprovalBindingKey(input.previewTrust)
      : null;
  const insert = db.insert(approvalRequests).values({
    id: requestId,
    teamId: presentation.teamId,
    actionType: input.actionType,
    bindingKey,
    targetResource: presentation.targetResource,
    reason: input.reason,
    status: "pending",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    inputSummary: {
      riskLevel: presentation.riskLevel,
      resourceLabel: presentation.resourceLabel,
      commandSummary: presentation.commandSummary,
      recommendedChecks: presentation.recommendedChecks,
      requestedAt: createdAt.toISOString(),
      expiresAt: presentation.expiresAt,
      ...("previewTrust" in presentation ? { previewTrust: presentation.previewTrust } : {})
    },
    createdAt
  });
  const [request] =
    input.actionType === "preview-deployment"
      ? await insert.onConflictDoNothing().returning()
      : await insert.returning();
  if (!request) return null;

  await db.insert(auditEntries).values({
    actorType: input.requestedByUserId ? "user" : "system",
    actorId: input.requestedByUserId ?? "preview-webhook",
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `approval-request/${requestId}`,
    action: "approval.request",
    inputSummary: `Approval requested for ${presentation.resourceLabel}.`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      teamId: presentation.teamId,
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: presentation.resourceLabel,
      detail: `Approval requested for ${presentation.resourceLabel}.`
    }
  });

  try {
    const notification = await buildApprovalNotification({
      eventType: "approval.request",
      status: "requested",
      requestId,
      actionType: input.actionType,
      resourceLabel: presentation.resourceLabel,
      requestedByEmail: input.requestedByEmail,
      reason: input.reason
    });
    await dispatchNotification(notification);
  } catch {
    // Approval creation must not fail because delivery integrations are degraded.
  }

  return request;
}

function samePreviewApprovalBinding(left: PreviewApprovalBinding, right: PreviewApprovalBinding) {
  return (
    left.providerType === right.providerType &&
    left.providerId === right.providerId &&
    left.installationId === right.installationId &&
    left.sourceRepository === right.sourceRepository &&
    left.baseRepository === right.baseRepository &&
    left.commitSha === right.commitSha &&
    left.policy === right.policy &&
    left.policyRevision === right.policyRevision &&
    left.serviceId === right.serviceId &&
    left.preview.target === right.preview.target &&
    left.preview.branch === right.preview.branch &&
    left.preview.pullRequestNumber === right.preview.pullRequestNumber &&
    left.preview.action === right.preview.action &&
    left.allowedSecretProfile === right.allowedSecretProfile
  );
}

export async function createOrReusePreviewApprovalRequest(
  input: Extract<CreateApprovalRequestInput, { actionType: "preview-deployment" }>
) {
  const bindingKey = buildPreviewApprovalBindingKey(input.previewTrust);
  const candidates = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.teamId, input.teamId),
        eq(approvalRequests.bindingKey, bindingKey),
        eq(approvalRequests.status, "pending")
      )
    )
    .orderBy(desc(approvalRequests.createdAt))
    .limit(24);

  for (const candidate of candidates) {
    if (candidate.actionType !== "preview-deployment") {
      continue;
    }

    const summary = asRecord(candidate.inputSummary);
    const binding = readPreviewApprovalBinding(summary.previewTrust);
    if (!binding || !samePreviewApprovalBinding(binding, input.previewTrust)) {
      continue;
    }

    const expiresAt = readPreviewApprovalExpiry(summary);
    const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      if (candidate.status === "pending") {
        await db
          .update(approvalRequests)
          .set({ status: "expired", resolvedAt: new Date() })
          .where(
            and(
              eq(approvalRequests.id, candidate.id),
              eq(approvalRequests.teamId, input.teamId),
              eq(approvalRequests.status, "pending")
            )
          );
      }
      continue;
    }

    if (candidate.status === "pending") {
      return { status: "pending" as const, request: candidate };
    }
  }

  const request = await createApprovalRequest(input);
  if (!request) {
    const [concurrent] = await db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.teamId, input.teamId),
          eq(approvalRequests.bindingKey, bindingKey),
          eq(approvalRequests.status, "pending")
        )
      )
      .limit(1);
    return concurrent
      ? { status: "pending" as const, request: concurrent }
      : { status: "invalid" as const, request: null };
  }

  return { status: "created" as const, request };
}

export async function listApprovalQueue(teamId: string, limit = 24) {
  const requests = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.teamId, teamId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit);

  const enriched = requests.map(enrichApproval);
  return {
    summary: {
      totalRequests: enriched.length,
      pendingRequests: enriched.filter((request) => request.status === "pending").length,
      approvedRequests: enriched.filter((request) => request.status === "approved").length,
      rejectedRequests: enriched.filter((request) => request.status === "rejected").length,
      criticalRequests: enriched.filter(
        (request) => request.status === "pending" && request.riskLevel === "critical"
      ).length
    },
    requests: enriched
  };
}

export async function approveApprovalRequest(
  requestId: string,
  teamId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
    .limit(1);
  if (!request) return { status: "not-found" as const };
  if (request.status !== "pending") {
    return { status: "invalid-state" as const, currentStatus: request.status };
  }
  const summary = asRecord(request.inputSummary);
  const expiresAt = readPreviewApprovalExpiry(summary) ?? readString(summary, "expiresAt", "");
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    const [expiredRequest] = await db
      .update(approvalRequests)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(
        and(
          eq(approvalRequests.id, requestId),
          eq(approvalRequests.teamId, teamId),
          eq(approvalRequests.status, "pending")
        )
      )
      .returning({ id: approvalRequests.id });
    if (!expiredRequest) {
      const [current] = await db
        .select({ status: approvalRequests.status })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
        .limit(1);
      return current
        ? { status: "invalid-state" as const, currentStatus: current.status }
        : { status: "not-found" as const };
    }
    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: userId,
      actorEmail: email,
      actorRole: role,
      targetResource: `approval-request/${requestId}`,
      action: "approval.expire",
      inputSummary: `Approval expired before ${readString(summary, "resourceLabel", request.targetResource)} could be approved.`,
      permissionScope: "policy:override",
      outcome: "failure",
      metadata: {
        teamId,
        resourceType: "approval-request",
        resourceId: requestId,
        expiresAt
      }
    });
    return { status: "expired" as const };
  }
  if (request.requestedByUserId === userId) {
    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: userId,
      actorEmail: email,
      actorRole: role,
      targetResource: `approval-request/${requestId}`,
      action: "approval.approve",
      inputSummary: `Blocked self-approval for ${readString(summary, "resourceLabel", request.targetResource)}.`,
      permissionScope: "policy:override",
      outcome: "failure",
      metadata: {
        teamId,
        resourceType: "approval-request",
        resourceId: requestId,
        resourceLabel: readString(summary, "resourceLabel", request.targetResource),
        detail: `Blocked self-approval for ${readString(summary, "resourceLabel", request.targetResource)}.`
      }
    });

    return { status: "self-approval" as const };
  }

  const [approvedRequest] = await db
    .update(approvalRequests)
    .set({
      status: "approved",
      resolvedByUserId: userId,
      resolvedByEmail: email,
      resolvedAt: new Date()
    })
    .where(
      and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.teamId, teamId),
        eq(approvalRequests.status, "pending")
      )
    )
    .returning();
  if (!approvedRequest) {
    const [current] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
      .limit(1);
    return current
      ? { status: "invalid-state" as const, currentStatus: current.status }
      : { status: "not-found" as const };
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `approval-request/${requestId}`,
    action: "approval.approve",
    inputSummary: `Approved ${readString(summary, "resourceLabel", request.targetResource)}.`,
    permissionScope: "policy:override",
    outcome: "success",
    metadata: {
      teamId,
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      detail: `Approved ${readString(summary, "resourceLabel", request.targetResource)}.`
    }
  });

  try {
    const notification = await buildApprovalNotification({
      eventType: "approval.approve",
      status: "approved",
      requestId,
      actionType: request.actionType,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      requestedByEmail: request.requestedByEmail,
      decidedByEmail: email,
      reason: request.reason
    });
    await dispatchNotification(notification);
  } catch {
    // Approval execution must not fail because delivery integrations are degraded.
  }

  if (request.actionType === "backup-restore") {
    const backupRunId = request.targetResource.split("/")[1];
    if (backupRunId) {
      await queueBackupRestore(backupRunId, userId, email, role, {
        teamId,
        approvalRequestId: requestId
      });
    }
  }

  if (request.actionType === "preview-deployment") {
    const binding = readPreviewApprovalBinding(summary.previewTrust);
    const serviceId = binding?.serviceId;
    const result =
      binding && serviceId
        ? await triggerDeploy({
            serviceId,
            commitSha: binding.commitSha,
            preview: {
              target: binding.preview.target,
              branch: binding.preview.branch,
              action: binding.preview.action,
              ...(binding.preview.pullRequestNumber !== null
                ? { pullRequestNumber: binding.preview.pullRequestNumber }
                : {})
            },
            previewProviderType: binding.providerType,
            previewAuthorization: {
              kind: "approval",
              approvalRequestId: requestId
            },
            requestedByUserId: userId,
            requestedByEmail: email,
            requestedByRole: role,
            trigger: "webhook"
          })
        : null;
    const queued = result?.status === "ok";
    const detail = queued
      ? `Queued the approved preview for ${binding!.commitSha.slice(0, 12)}.`
      : "Approval was recorded, but DaoFlow could not queue the bound preview deployment.";

    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: userId,
      actorEmail: email,
      actorRole: role,
      targetResource: serviceId ? `service/${serviceId}` : `approval-request/${requestId}`,
      action: queued ? "preview.approval.queued" : "preview.approval.queue_failed",
      inputSummary: detail,
      permissionScope: "deploy:start",
      outcome: queued ? "success" : "failure",
      metadata: {
        teamId,
        approvalRequestId: requestId,
        providerType: binding?.providerType ?? null,
        sourceRepository: binding?.sourceRepository ?? null,
        commitSha: binding?.commitSha ?? null,
        policyRevision: binding?.policyRevision ?? null,
        allowedSecretProfile: binding?.allowedSecretProfile ?? null,
        deploymentId: queued ? result.deployment.id : null,
        status: result?.status ?? "invalid-binding"
      }
    });
    await db.insert(events).values({
      kind: queued ? "preview.approval.queued" : "preview.approval.queue_failed",
      resourceType: serviceId ? "service" : "approval-request",
      resourceId: serviceId ?? requestId,
      summary: detail,
      detail: queued
        ? "DaoFlow will use the approved immutable commit when the worker prepares the preview."
        : "No preview environment or secret material was prepared for this failed approval dispatch.",
      severity: queued ? "info" : "warning",
      metadata: {
        teamId,
        approvalRequestId: requestId,
        providerType: binding?.providerType ?? null,
        sourceRepository: binding?.sourceRepository ?? null,
        commitSha: binding?.commitSha ?? null,
        policyRevision: binding?.policyRevision ?? null,
        allowedSecretProfile: binding?.allowedSecretProfile ?? null,
        deploymentId: queued ? result.deployment.id : null,
        status: result?.status ?? "invalid-binding"
      },
      createdAt: new Date()
    });
  }

  const [updated] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)));
  return { status: "ok" as const, request: enrichApproval(updated) };
}

export async function rejectApprovalRequest(
  requestId: string,
  teamId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
    .limit(1);
  if (!request) return { status: "not-found" as const };
  if (request.status !== "pending") {
    return { status: "invalid-state" as const, currentStatus: request.status };
  }

  const [rejectedRequest] = await db
    .update(approvalRequests)
    .set({
      status: "rejected",
      resolvedByUserId: userId,
      resolvedByEmail: email,
      resolvedAt: new Date()
    })
    .where(
      and(
        eq(approvalRequests.id, requestId),
        eq(approvalRequests.teamId, teamId),
        eq(approvalRequests.status, "pending")
      )
    )
    .returning();
  if (!rejectedRequest) {
    const [current] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
      .limit(1);
    return current
      ? { status: "invalid-state" as const, currentStatus: current.status }
      : { status: "not-found" as const };
  }

  const summary = asRecord(request.inputSummary);
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `approval-request/${requestId}`,
    action: "approval.reject",
    inputSummary: `Rejected ${readString(summary, "resourceLabel", request.targetResource)}.`,
    permissionScope: "policy:override",
    outcome: "success",
    metadata: {
      teamId,
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      detail: `Rejected ${readString(summary, "resourceLabel", request.targetResource)}.`
    }
  });

  try {
    const notification = await buildApprovalNotification({
      eventType: "approval.reject",
      status: "rejected",
      requestId,
      actionType: request.actionType,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      requestedByEmail: request.requestedByEmail,
      decidedByEmail: email,
      reason: request.reason
    });
    await dispatchNotification(notification);
  } catch {
    // Approval rejection must not fail because delivery integrations are degraded.
  }

  const [updated] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)));
  return { status: "ok" as const, request: enrichApproval(updated) };
}
