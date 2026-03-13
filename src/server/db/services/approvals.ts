import { randomUUID } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { approvalRequests } from "../schema/audit";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "../../../shared/authz";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

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

export async function createApprovalRequest(input: CreateApprovalRequestInput) {
  const requestId = id();
  const targetResource =
    input.actionType === "compose-release"
      ? `compose-service/${input.composeServiceId}`
      : `backup-run/${input.backupRunId}`;

  const [request] = await db.insert(approvalRequests).values({
    id: requestId,
    actionType: input.actionType,
    targetResource,
    reason: input.reason,
    status: "pending",
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    inputSummary: { actionType: input.actionType }
  }).returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `approval-request/${requestId}`,
    action: "approval.requested",
    inputSummary: `Approval requested: ${input.actionType} — ${input.reason}`,
    permissionScope: "deploy:start",
    outcome: "success"
  });

  return request;
}

function enrichApproval(r: typeof approvalRequests.$inferSelect) {
  return {
    ...r,
    requestedBy: r.requestedByEmail ?? "",
    resourceLabel: r.targetResource,
    riskLevel: "medium" as const,
    commandSummary: r.reason ?? "",
    requestedAt: r.createdAt.toISOString(),
    expiresAt: null as string | null,
    decidedBy: r.resolvedByEmail ?? null,
    decidedAt: r.resolvedAt?.toISOString() ?? null,
    recommendedChecks: [] as string[],
    createdAt: r.createdAt.toISOString()
  };
}

export async function listApprovalQueue(limit = 24) {
  const requests = await db.select().from(approvalRequests).orderBy(desc(approvalRequests.createdAt)).limit(limit);

  return {
    summary: {
      totalRequests: requests.length,
      pendingRequests: requests.filter(r => r.status === "pending").length,
      approvedRequests: requests.filter(r => r.status === "approved").length,
      rejectedRequests: requests.filter(r => r.status === "rejected").length,
      criticalRequests: 0
    },
    requests: requests.map(enrichApproval)
  };
}

export async function approveApprovalRequest(
  requestId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  if (!rows[0]) return { status: "not-found" as const };
  if (rows[0].status !== "pending") return { status: "invalid-state" as const, currentStatus: rows[0].status };

  await db.update(approvalRequests)
    .set({ status: "approved", resolvedByEmail: email, resolvedAt: new Date() })
    .where(eq(approvalRequests.id, requestId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `approval-request/${requestId}`,
    action: "approval.approved",
    inputSummary: `Approved request ${requestId}`,
    permissionScope: "policy:override",
    outcome: "success"
  });

  const [updated] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  return { status: "ok" as const, request: enrichApproval(updated) };
}

export async function rejectApprovalRequest(
  requestId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  if (!rows[0]) return { status: "not-found" as const };
  if (rows[0].status !== "pending") return { status: "invalid-state" as const, currentStatus: rows[0].status };

  await db.update(approvalRequests)
    .set({ status: "rejected", resolvedByEmail: email, resolvedAt: new Date() })
    .where(eq(approvalRequests.id, requestId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `approval-request/${requestId}`,
    action: "approval.rejected",
    inputSummary: `Rejected request ${requestId}`,
    permissionScope: "policy:override",
    outcome: "success"
  });

  const [updated] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  return { status: "ok" as const, request: enrichApproval(updated) };
}
