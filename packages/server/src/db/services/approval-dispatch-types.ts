import { createHash } from "node:crypto";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readNumber, readString } from "./json-helpers";
import { readPreviewApprovalBinding, type PreviewApprovalBinding } from "../../preview-trust";
import type { approvalActionDispatches, approvalRequests } from "../schema/audit";

export type ApprovalDispatchStatus =
  "pending" | "retrying" | "dispatched" | "succeeded" | "terminal-failure";

type DispatchActor = {
  userId: string;
  email: string;
  role: AppRole;
};

export type ApprovalActionPayload =
  | {
      version: 1;
      actionType: "invalid";
      targetResource: string;
      actor: DispatchActor;
      reason: string;
      snapshot: Record<string, unknown>;
    }
  | {
      version: 1;
      actionType: "compose-release";
      targetResource: string;
      actor: DispatchActor;
      composeServiceId: string;
      commitSha: string;
      imageTag: string;
      snapshot: Record<string, unknown>;
    }
  | {
      version: 1;
      actionType: "backup-restore";
      targetResource: string;
      actor: DispatchActor;
      backupRunId: string;
      snapshot: Record<string, unknown>;
    }
  | {
      version: 1;
      actionType: "external-artifact-restore";
      targetResource: string;
      actor: DispatchActor;
      artifactId: string;
      targetVolumeId: string;
      snapshot: Record<string, unknown>;
    }
  | {
      version: 1;
      actionType: "preview-deployment";
      targetResource: string;
      actor: DispatchActor;
      binding: PreviewApprovalBinding;
      snapshot: Record<string, unknown>;
    };

type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
type ApprovalDispatchRow = typeof approvalActionDispatches.$inferSelect;

function readActor(value: unknown): DispatchActor | null {
  const actor = asRecord(value);
  const userId = readString(actor, "userId");
  const email = readString(actor, "email");
  const role = readString(actor, "role");

  if (!userId || !email || !role) {
    return null;
  }

  return { userId, email, role: role as AppRole };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasSnapshotStrings(snapshot: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => Boolean(readString(snapshot, key)));
}

function hasExternalArtifactIdentity(snapshot: Record<string, unknown>) {
  return (
    Boolean(readString(snapshot, "artifactObjectVersion")) ||
    Boolean(readString(snapshot, "artifactObjectEtag"))
  );
}

export function hashApprovalActionPayload(payload: ApprovalActionPayload): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function buildApprovalActionPayload(input: {
  request: ApprovalRequestRow;
  actor: DispatchActor;
}): ApprovalActionPayload {
  const summary = asRecord(input.request.inputSummary);
  const action = asRecord(summary.actionPayload);
  const snapshot = asRecord(action.snapshot);

  if (input.request.actionType === "compose-release") {
    const composeServiceId = readString(action, "composeServiceId");
    const commitSha = readString(action, "commitSha");
    const imageTag = readString(action, "imageTag").trim();
    return composeServiceId &&
      commitSha &&
      imageTag &&
      hasSnapshotStrings(snapshot, [
        "projectId",
        "environmentId",
        "targetServerId",
        "composeFilePath",
        "secretPolicy"
      ])
      ? {
          version: 1,
          actionType: "compose-release",
          targetResource: input.request.targetResource,
          actor: input.actor,
          composeServiceId,
          commitSha,
          imageTag,
          snapshot
        }
      : {
          version: 1,
          actionType: "invalid",
          targetResource: input.request.targetResource,
          actor: input.actor,
          reason: "The approved Compose release predates the immutable dispatch payload.",
          snapshot
        };
  }

  if (input.request.actionType === "backup-restore") {
    const backupRunId = readString(action, "backupRunId");
    return backupRunId &&
      hasSnapshotStrings(snapshot, [
        "artifactPath",
        "artifactChecksum",
        "backupPolicyId",
        "backupPolicyUpdatedAt",
        "backupDestinationId",
        "backupDestinationUpdatedAt",
        "volumeId",
        "volumeUpdatedAt",
        "volumeMountPath",
        "targetServerId",
        "restoreDestination",
        "secretPolicy"
      ])
      ? {
          version: 1,
          actionType: "backup-restore",
          targetResource: input.request.targetResource,
          actor: input.actor,
          backupRunId,
          snapshot
        }
      : {
          version: 1,
          actionType: "invalid",
          targetResource: input.request.targetResource,
          actor: input.actor,
          reason: "The approved backup restore predates the immutable dispatch payload.",
          snapshot
        };
  }

  if (input.request.actionType === "external-artifact-restore") {
    const artifactId = readString(action, "artifactId");
    const targetVolumeId = readString(action, "targetVolumeId");
    return artifactId &&
      targetVolumeId &&
      hasSnapshotStrings(snapshot, [
        "artifactId",
        "artifactSha256",
        "artifactObjectKey",
        "artifactVerifiedAt",
        "destinationId",
        "destinationUpdatedAt",
        "targetVolumeId",
        "targetVolumeUpdatedAt",
        "targetServerId",
        "targetMountPath",
        "targetServiceId",
        "targetServiceUpdatedAt",
        "runtimeServiceName",
        "databaseEngine",
        "databaseName",
        "databaseUser",
        "secretPolicy"
      ]) &&
      hasExternalArtifactIdentity(snapshot)
      ? {
          version: 1,
          actionType: "external-artifact-restore",
          targetResource: input.request.targetResource,
          actor: input.actor,
          artifactId,
          targetVolumeId,
          snapshot
        }
      : {
          version: 1,
          actionType: "invalid",
          targetResource: input.request.targetResource,
          actor: input.actor,
          reason: "The approved external artifact restore binding is incomplete.",
          snapshot
        };
  }

  if (input.request.actionType === "preview-deployment") {
    const binding = readPreviewApprovalBinding(summary.previewTrust);
    return binding &&
      hasSnapshotStrings(snapshot, [
        "projectId",
        "environmentId",
        "targetServerId",
        "allowedSecretProfile"
      ])
      ? {
          version: 1,
          actionType: "preview-deployment",
          targetResource: input.request.targetResource,
          actor: input.actor,
          binding,
          snapshot
        }
      : {
          version: 1,
          actionType: "invalid",
          targetResource: input.request.targetResource,
          actor: input.actor,
          reason: "The approved preview deployment binding is incomplete.",
          snapshot
        };
  }

  return {
    version: 1,
    actionType: "invalid",
    targetResource: input.request.targetResource,
    actor: input.actor,
    reason: "The approval action type is not dispatchable.",
    snapshot
  };
}

export function readApprovalActionPayload(value: unknown): ApprovalActionPayload | null {
  const payload = asRecord(value);
  const actionType = readString(payload, "actionType");
  const version = readNumber(payload, "version", null);
  const targetResource = readString(payload, "targetResource");
  const actor = readActor(payload.actor);
  if (!targetResource || !actor || version !== 1) return null;
  const snapshot = asRecord(payload.snapshot);

  if (actionType === "invalid") {
    const reason = readString(payload, "reason", "The durable approval action payload is invalid.");
    return { version: 1, actionType, targetResource, actor, reason, snapshot };
  }

  if (actionType === "compose-release") {
    const composeServiceId = readString(payload, "composeServiceId");
    const commitSha = readString(payload, "commitSha");
    const imageTag = readString(payload, "imageTag").trim();
    return composeServiceId && commitSha && imageTag
      ? {
          version: 1,
          actionType,
          targetResource,
          actor,
          composeServiceId,
          commitSha,
          imageTag,
          snapshot
        }
      : null;
  }

  if (actionType === "backup-restore") {
    const backupRunId = readString(payload, "backupRunId");
    return backupRunId
      ? { version: 1, actionType, targetResource, actor, backupRunId, snapshot }
      : null;
  }

  if (actionType === "external-artifact-restore") {
    const artifactId = readString(payload, "artifactId");
    const targetVolumeId = readString(payload, "targetVolumeId");
    return artifactId && targetVolumeId
      ? { version: 1, actionType, targetResource, actor, artifactId, targetVolumeId, snapshot }
      : null;
  }

  if (actionType === "preview-deployment") {
    const binding = readPreviewApprovalBinding(payload.binding);
    return binding ? { version: 1, actionType, targetResource, actor, binding, snapshot } : null;
  }

  return null;
}

export function getApprovalDispatchStatusLabel(status: string): string {
  if (status === "terminal-failure") return "terminal failure";
  return status;
}

export function getApprovalDispatchStatusTone(status: string) {
  if (status === "succeeded") return "healthy" as const;
  if (status === "terminal-failure") return "failed" as const;
  if (status === "retrying" || status === "dispatched") return "running" as const;
  return "queued" as const;
}

export function toApprovalDispatchView(dispatch: ApprovalDispatchRow | null | undefined) {
  if (!dispatch) {
    return {
      dispatchStatus: null,
      dispatchStatusLabel: null,
      dispatchStatusTone: null,
      operationId: null,
      dispatchAttempts: 0,
      dispatchError: null,
      dispatchNextAttemptAt: null,
      dispatchedAt: null,
      dispatchCompletedAt: null
    };
  }

  return {
    dispatchStatus: dispatch.status,
    dispatchStatusLabel: getApprovalDispatchStatusLabel(dispatch.status),
    dispatchStatusTone: getApprovalDispatchStatusTone(dispatch.status),
    operationId: dispatch.operationId,
    dispatchAttempts: readNumber({ attempts: dispatch.attemptCount }, "attempts", 0) ?? 0,
    dispatchError: dispatch.lastError,
    dispatchNextAttemptAt:
      dispatch.status === "pending" || dispatch.status === "retrying"
        ? (dispatch.nextAttemptAt?.toISOString() ?? null)
        : null,
    dispatchedAt: dispatch.dispatchedAt?.toISOString() ?? null,
    dispatchCompletedAt: dispatch.completedAt?.toISOString() ?? null
  };
}
