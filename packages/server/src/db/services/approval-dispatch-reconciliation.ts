import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { approvalActionDispatches, auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { backupRestores } from "../schema/storage";
import type { ApprovalDispatchStatus } from "./approval-dispatch-types";
import { DeploymentConclusion, DeploymentLifecycleStatus } from "@daoflow/shared";

type ApprovalDispatchTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ApprovalDispatchRow = typeof approvalActionDispatches.$inferSelect;

function auditMetadata(dispatch: ApprovalDispatchRow, detail: string) {
  return {
    teamId: dispatch.teamId,
    resourceType: "approval-action-dispatch",
    resourceId: dispatch.id,
    resourceLabel: `Approval dispatch ${dispatch.id}`,
    approvalRequestId: dispatch.approvalRequestId,
    approvalDispatchId: dispatch.id,
    operationId: dispatch.operationId,
    actionType: dispatch.actionType,
    detail
  };
}

async function getOperationTerminalState(
  tx: ApprovalDispatchTransaction,
  dispatch: ApprovalDispatchRow
) {
  if (dispatch.actionType === "backup-restore") {
    const [restore] = await tx
      .select({ status: backupRestores.status, error: backupRestores.error })
      .from(backupRestores)
      .where(eq(backupRestores.id, dispatch.operationId))
      .limit(1);
    if (!restore)
      return { status: "failed" as const, detail: "The linked restore operation is missing." };
    if (restore.status === "succeeded")
      return { status: "succeeded" as const, detail: "Restore completed." };
    if (restore.status === "failed") {
      return { status: "failed" as const, detail: restore.error ?? "Restore failed." };
    }
    return null;
  }

  const [deployment] = await tx
    .select({ status: deployments.status, conclusion: deployments.conclusion })
    .from(deployments)
    .where(eq(deployments.id, dispatch.operationId))
    .limit(1);
  if (!deployment)
    return { status: "failed" as const, detail: "The linked deployment operation is missing." };
  if (
    deployment.status === DeploymentLifecycleStatus.Completed &&
    deployment.conclusion === DeploymentConclusion.Succeeded
  ) {
    return { status: "succeeded" as const, detail: "Deployment completed successfully." };
  }
  if (
    deployment.status === DeploymentLifecycleStatus.Failed ||
    deployment.conclusion === DeploymentConclusion.Failed ||
    deployment.conclusion === DeploymentConclusion.Cancelled ||
    deployment.conclusion === DeploymentConclusion.Skipped
  ) {
    return { status: "failed" as const, detail: "Deployment reached a terminal failure state." };
  }
  return null;
}

async function reconcileApprovalActionDispatch(dispatchId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [dispatch] = await tx
      .select()
      .from(approvalActionDispatches)
      .where(
        and(
          eq(approvalActionDispatches.id, dispatchId),
          eq(approvalActionDispatches.status, "dispatched")
        )
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!dispatch) return null;

    const terminal = await getOperationTerminalState(tx, dispatch);
    if (!terminal) {
      await tx
        .update(approvalActionDispatches)
        .set({ lastReconciledAt: now, updatedAt: now })
        .where(eq(approvalActionDispatches.id, dispatch.id));
      return null;
    }

    const status: ApprovalDispatchStatus =
      terminal.status === "succeeded" ? "succeeded" : "terminal-failure";
    const summary =
      status === "succeeded"
        ? `Approved operation ${dispatch.operationId} completed successfully.`
        : `Approved operation ${dispatch.operationId} reached terminal failure: ${terminal.detail}`;
    const [updated] = await tx
      .update(approvalActionDispatches)
      .set({
        status,
        lastError: status === "terminal-failure" ? terminal.detail : null,
        lastReconciledAt: now,
        completedAt: now,
        updatedAt: now
      })
      .where(eq(approvalActionDispatches.id, dispatch.id))
      .returning();
    if (!updated) return null;

    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: "approval-dispatch-monitor",
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `approval-dispatch/${updated.id}`,
      action:
        status === "succeeded"
          ? "approval.dispatch.succeeded"
          : "approval.dispatch.terminal_failure",
      inputSummary: summary,
      permissionScope: "approvals:decide",
      outcome: status === "succeeded" ? "success" : "failure",
      metadata: auditMetadata(updated, summary)
    });

    return updated;
  });
}

export async function reconcileApprovalActionDispatches(input?: { limit?: number; now?: Date }) {
  const now = input?.now ?? new Date();
  const candidates = await db
    .select({ id: approvalActionDispatches.id })
    .from(approvalActionDispatches)
    .where(eq(approvalActionDispatches.status, "dispatched"))
    .orderBy(
      sql`${approvalActionDispatches.lastReconciledAt} asc nulls first`,
      asc(approvalActionDispatches.dispatchedAt)
    )
    .limit(input?.limit ?? 32);

  const completed: ApprovalDispatchRow[] = [];
  for (const candidate of candidates) {
    const result = await reconcileApprovalActionDispatch(candidate.id, now);
    if (result) completed.push(result);
  }

  return completed;
}
