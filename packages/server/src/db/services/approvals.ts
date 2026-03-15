import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { queueBackupRestore } from "./backups";
import { listComposeReleaseCatalog } from "./compose";
import { approvalRequests, auditEntries } from "../schema/audit";
import { backupPolicies, backupRuns } from "../schema/storage";
import type { AppRole } from "@daoflow/shared";
import { newId as id, asRecord, readString, readStringArray } from "./json-helpers";

export type ApprovalActionType = "compose-release" | "backup-restore";

export type CreateApprovalRequestInput =
  | {
      actionType: "compose-release";
      composeServiceId: string;
      commitSha: string;
      imageTag?: string | null;
      reason: string;
      requestedByUserId: string;
      requestedByEmail: string;
      requestedByRole: AppRole;
    }
  | {
      actionType: "backup-restore";
      backupRunId: string;
      reason: string;
      requestedByUserId: string;
      requestedByEmail: string;
      requestedByRole: AppRole;
    };

async function resolveApprovalPresentation(input: CreateApprovalRequestInput) {
  if (input.actionType === "compose-release") {
    const catalog = await listComposeReleaseCatalog(100);
    const service = catalog.services.find((candidate) => candidate.id === input.composeServiceId);
    if (!service) return null;

    return {
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

  const serviceName =
    policy.id === "bpol_foundation_volume_daily" ? "postgres-volume" : policy.name;
  const environmentName =
    policy.id === "bpol_foundation_volume_daily" ? "production-us-west" : "staging";
  const destination = "foundation-vps-1:/var/lib/postgresql/data";

  return {
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
  const summary = asRecord(request.inputSummary);
  return {
    ...request,
    requestedBy: request.requestedByEmail ?? "",
    resourceLabel: readString(summary, "resourceLabel", request.targetResource),
    riskLevel: readString(summary, "riskLevel", "medium") as "medium" | "elevated" | "critical",
    commandSummary: readString(summary, "commandSummary", request.reason ?? ""),
    requestedAt: readString(summary, "requestedAt", request.createdAt.toISOString()),
    expiresAt: readString(summary, "expiresAt", ""),
    decidedBy: request.resolvedByEmail ?? null,
    decidedAt: request.resolvedAt?.toISOString() ?? null,
    recommendedChecks: readStringArray(summary, "recommendedChecks"),
    createdAt: request.createdAt.toISOString()
  };
}

export async function createApprovalRequest(input: CreateApprovalRequestInput) {
  const presentation = await resolveApprovalPresentation(input);
  if (!presentation) return null;

  const requestId = id();
  const createdAt = new Date();
  const [request] = await db
    .insert(approvalRequests)
    .values({
      id: requestId,
      actionType: input.actionType,
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
        expiresAt: presentation.expiresAt
      },
      createdAt
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `approval-request/${requestId}`,
    action: "approval.request",
    inputSummary: `Approval requested for ${presentation.resourceLabel}.`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: presentation.resourceLabel,
      detail: `Approval requested for ${presentation.resourceLabel}.`
    }
  });

  return request;
}

export async function listApprovalQueue(limit = 24) {
  const requests = await db
    .select()
    .from(approvalRequests)
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
  userId: string,
  email: string,
  role: AppRole
) {
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  if (!request) return { status: "not-found" as const };
  if (request.status !== "pending") {
    return { status: "invalid-state" as const, currentStatus: request.status };
  }

  await db
    .update(approvalRequests)
    .set({
      status: "approved",
      resolvedByUserId: userId,
      resolvedByEmail: email,
      resolvedAt: new Date()
    })
    .where(eq(approvalRequests.id, requestId));

  const summary = asRecord(request.inputSummary);
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
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      detail: `Approved ${readString(summary, "resourceLabel", request.targetResource)}.`
    }
  });

  if (request.actionType === "backup-restore") {
    const backupRunId = request.targetResource.split("/")[1];
    if (backupRunId) {
      await queueBackupRestore(backupRunId, userId, email, role);
    }
  }

  const [updated] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId));
  return { status: "ok" as const, request: enrichApproval(updated) };
}

export async function rejectApprovalRequest(
  requestId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  if (!request) return { status: "not-found" as const };
  if (request.status !== "pending") {
    return { status: "invalid-state" as const, currentStatus: request.status };
  }

  await db
    .update(approvalRequests)
    .set({
      status: "rejected",
      resolvedByUserId: userId,
      resolvedByEmail: email,
      resolvedAt: new Date()
    })
    .where(eq(approvalRequests.id, requestId));

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
      resourceType: "approval-request",
      resourceId: requestId,
      resourceLabel: readString(summary, "resourceLabel", request.targetResource),
      detail: `Rejected ${readString(summary, "resourceLabel", request.targetResource)}.`
    }
  });

  const [updated] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId));
  return { status: "ok" as const, request: enrichApproval(updated) };
}
