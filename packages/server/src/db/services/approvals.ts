import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { listComposeReleaseCatalog } from "./compose";
import { approvalActionDispatches, approvalRequests, auditEntries } from "../schema/audit";
import { services } from "../schema/services";
import { environments, projects } from "../schema/projects";
import { backupDestinations } from "../schema/destinations";
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
import { resolveVolumeTeamId } from "./backup-resource-team";
import { createApprovalActionDispatchIntent } from "./approval-dispatch-service";
import { buildApprovalActionPayload, toApprovalDispatchView } from "./approval-dispatch-types";

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
    const effectiveImageTag = (input.imageTag ?? service.imageReference).trim();
    if (!effectiveImageTag) return null;
    const [target] = await db
      .select({ teamId: projects.teamId, project: projects, environment: environments })
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
      commandSummary: `Release ${effectiveImageTag} for ${service.serviceName} on ${service.targetServerName} using commit ${input.commitSha}.`,
      recommendedChecks: [
        "Confirm the target service dependencies are healthy before dispatching the release.",
        "Verify the Compose diff still matches the intended release track."
      ],
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      actionPayload: {
        composeServiceId: input.composeServiceId,
        commitSha: input.commitSha,
        imageTag: effectiveImageTag,
        snapshot: {
          projectId: target.project.id,
          environmentId: service.environmentId,
          environmentName: service.environmentName,
          targetServerId: service.targetServerId,
          targetServerName: service.targetServerName,
          composeFilePath: service.composeFilePath,
          serviceName: service.serviceName,
          imageReference: service.imageReference,
          releaseTrack: service.releaseTrack,
          environmentConfig: asRecord(target.environment.config),
          projectPreviewPolicyRevision: target.project.previewPolicyRevision,
          secretPolicy: "environment-scoped-encrypted"
        }
      }
    } as const;
  }

  if (input.actionType === "preview-deployment") {
    const [row] = await db
      .select({ service: services, project: projects })
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
      .limit(1);
    const service = row?.service;
    if (!service || service.projectId === null || input.previewTrust.serviceId !== service.id) {
      return null;
    }
    const [environment] = await db
      .select()
      .from(environments)
      .where(eq(environments.id, service.environmentId))
      .limit(1);
    if (!environment) return null;
    const effectiveTargetServerId =
      service.targetServerId ?? readString(asRecord(environment.config), "targetServerId");
    if (!effectiveTargetServerId) return null;

    const preview = input.previewTrust.preview;
    if (preview.target !== "pull-request" || preview.action !== "deploy") {
      return null;
    }

    return {
      teamId: row.project.teamId,
      targetResource: `service/${service.id}`,
      resourceLabel: `${service.name} · PR #${preview.pullRequestNumber} @${input.previewTrust.commitSha.slice(0, 12)}`,
      riskLevel: "critical",
      commandSummary: `Deploy the approved ${input.previewTrust.providerType} commit ${input.previewTrust.commitSha} from ${input.previewTrust.sourceRepository}.`,
      recommendedChecks: [
        "Confirm the commit and source repository match the pull request you reviewed.",
        "Approve only when the project preview policy and target environment are still intended."
      ],
      expiresAt: input.previewTrust.expiresAt,
      previewTrust: input.previewTrust,
      actionPayload: {
        serviceId: service.id,
        snapshot: {
          projectId: row.project.id,
          environmentId: environment.id,
          targetServerId: effectiveTargetServerId,
          projectPreviewPolicy: row.project.previewPolicy,
          projectPreviewPolicyRevision: row.project.previewPolicyRevision,
          projectRepository: row.project.repoFullName,
          environmentConfig: asRecord(environment.config),
          allowedSecretProfile: input.previewTrust.allowedSecretProfile,
          bindingPolicyRevision: input.previewTrust.policyRevision
        }
      }
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
  if (!policy.destinationId) return null;
  const [backupDestination] = await db
    .select()
    .from(backupDestinations)
    .where(
      and(
        eq(backupDestinations.id, policy.destinationId),
        eq(backupDestinations.teamId, input.teamId)
      )
    )
    .limit(1);
  if (!backupDestination) return null;
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
    expiresAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
    actionPayload: {
      backupRunId: input.backupRunId,
      snapshot: {
        backupRunId: run.id,
        artifactPath: run.artifactPath,
        artifactChecksum: run.checksum,
        backupPolicyId: policy.id,
        backupPolicyUpdatedAt: policy.updatedAt.toISOString(),
        backupDestinationId: backupDestination.id,
        backupDestinationUpdatedAt: backupDestination.updatedAt.toISOString(),
        volumeId: volume.id,
        volumeUpdatedAt: volume.updatedAt.toISOString(),
        volumeMountPath: volume.mountPath,
        targetServerId: volume.serverId,
        restoreDestination: volume.mountPath,
        secretPolicy: "destination-credentials-encrypted"
      }
    }
  } as const;
}

function enrichApproval(
  request: typeof approvalRequests.$inferSelect,
  dispatch?: typeof approvalActionDispatches.$inferSelect | null
) {
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
    createdAt: request.createdAt.toISOString(),
    ...toApprovalDispatchView(dispatch)
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
      actionPayload: presentation.actionPayload,
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
      teamId: presentation.teamId,
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

  const dispatches =
    requests.length > 0
      ? await db
          .select()
          .from(approvalActionDispatches)
          .where(
            inArray(
              approvalActionDispatches.approvalRequestId,
              requests.map((request) => request.id)
            )
          )
      : [];
  const dispatchByRequestId = new Map(
    dispatches.map((dispatch) => [dispatch.approvalRequestId, dispatch])
  );
  const enriched = requests.map((request) =>
    enrichApproval(request, dispatchByRequestId.get(request.id))
  );
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
  const now = new Date();
  const decision = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.teamId, teamId)))
      .limit(1)
      .for("update");
    if (!request) return { status: "not-found" as const };
    if (request.status !== "pending") {
      return { status: "invalid-state" as const, currentStatus: request.status };
    }

    const summary = asRecord(request.inputSummary);
    const expiresAt = readPreviewApprovalExpiry(summary) ?? readString(summary, "expiresAt", "");
    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      await tx
        .update(approvalRequests)
        .set({ status: "expired", resolvedAt: now })
        .where(eq(approvalRequests.id, request.id));
      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: userId,
        actorEmail: email,
        actorRole: role,
        targetResource: `approval-request/${requestId}`,
        action: "approval.expire",
        inputSummary: `Approval expired before ${readString(summary, "resourceLabel", request.targetResource)} could be approved.`,
        permissionScope: "policy:override",
        outcome: "failure",
        metadata: { teamId, resourceType: "approval-request", resourceId: requestId, expiresAt }
      });
      return { status: "expired" as const };
    }

    if (request.requestedByUserId === userId) {
      await tx.insert(auditEntries).values({
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

    const dispatchId = id();
    const operationId = id();
    const actionPayload = buildApprovalActionPayload({
      request,
      actor: { userId, email, role }
    });
    if (actionPayload.actionType === "invalid") {
      const detail = `Invalidated legacy approval without a complete immutable action payload: ${actionPayload.reason}`;
      await tx
        .update(approvalRequests)
        .set({ status: "expired", resolvedAt: now })
        .where(eq(approvalRequests.id, request.id));
      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: userId,
        actorEmail: email,
        actorRole: role,
        targetResource: `approval-request/${requestId}`,
        action: "approval.invalidate_legacy_payload",
        inputSummary: detail,
        permissionScope: "policy:override",
        outcome: "failure",
        metadata: { teamId, resourceType: "approval-request", resourceId: requestId, detail }
      });
      return { status: "invalid-payload" as const };
    }
    const [approvedRequest] = await tx
      .update(approvalRequests)
      .set({
        status: "approved",
        resolvedByUserId: userId,
        resolvedByEmail: email,
        resolvedAt: now
      })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    if (!approvedRequest) {
      throw new Error("Approval decision could not be persisted.");
    }

    const dispatch = await createApprovalActionDispatchIntent(tx, {
      id: dispatchId,
      requestId: request.id,
      teamId,
      actionType: request.actionType,
      idempotencyKey: `approval:${request.id}`,
      operationId,
      actionPayload,
      now
    });
    const detail = `Approved ${readString(summary, "resourceLabel", request.targetResource)} and saved operation ${operationId} for durable dispatch.`;
    await tx.insert(auditEntries).values({
      actorType: "user",
      actorId: userId,
      actorEmail: email,
      actorRole: role,
      targetResource: `approval-request/${requestId}`,
      action: "approval.approve",
      inputSummary: detail,
      permissionScope: "policy:override",
      outcome: "success",
      metadata: {
        teamId,
        resourceType: "approval-request",
        resourceId: requestId,
        resourceLabel: readString(summary, "resourceLabel", request.targetResource),
        approvalRequestId: requestId,
        approvalDispatchId: dispatch.id,
        operationId,
        detail
      }
    });

    return { status: "ok" as const, request: approvedRequest, dispatch };
  });

  if (decision.status !== "ok") return decision;

  try {
    const notification = await buildApprovalNotification({
      eventType: "approval.approve",
      teamId: decision.request.teamId,
      status: "approved",
      requestId,
      actionType: decision.request.actionType,
      resourceLabel: readString(
        asRecord(decision.request.inputSummary),
        "resourceLabel",
        decision.request.targetResource
      ),
      requestedByEmail: decision.request.requestedByEmail,
      decidedByEmail: email,
      reason: decision.request.reason
    });
    await dispatchNotification(notification);
  } catch {
    // Approval decisions remain durable when notification delivery is degraded.
  }

  return {
    status: "ok" as const,
    request: enrichApproval(decision.request, decision.dispatch)
  };
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
      teamId: request.teamId,
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
