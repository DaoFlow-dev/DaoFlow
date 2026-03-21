import { asRecord, readString } from "./db/services/json-helpers";

export interface DeploymentCancellationSnapshot {
  cancelRequestedAt: string;
  cancelRequestedBy: string;
  cancelRequestedByUserId?: string;
  cancelRequestedByRole?: string;
}

export class DeploymentCancellationError extends Error {
  readonly cancelRequestedAt: string;
  readonly cancelRequestedBy: string;

  constructor(snapshot: DeploymentCancellationSnapshot) {
    super(
      snapshot.cancelRequestedBy
        ? `Deployment cancellation requested by ${snapshot.cancelRequestedBy}.`
        : "Deployment cancellation requested."
    );
    this.name = "DeploymentCancellationError";
    this.cancelRequestedAt = snapshot.cancelRequestedAt;
    this.cancelRequestedBy = snapshot.cancelRequestedBy;
  }
}

export function readDeploymentCancellationSnapshot(
  snapshot: unknown
): DeploymentCancellationSnapshot | null {
  const record = asRecord(snapshot);
  const cancelRequestedAt = readString(record, "cancelRequestedAt");
  if (!cancelRequestedAt) {
    return null;
  }

  const cancelRequestedBy = readString(record, "cancelRequestedBy");
  const cancelRequestedByUserId = readString(record, "cancelRequestedByUserId");
  const cancelRequestedByRole = readString(record, "cancelRequestedByRole");

  return {
    cancelRequestedAt,
    cancelRequestedBy,
    ...(cancelRequestedByUserId ? { cancelRequestedByUserId } : {}),
    ...(cancelRequestedByRole ? { cancelRequestedByRole } : {})
  };
}

export function writeDeploymentCancellationSnapshot(
  snapshot: unknown,
  input: {
    cancelRequestedAt: string;
    cancelRequestedBy: string;
    cancelRequestedByUserId?: string;
    cancelRequestedByRole?: string;
  }
): Record<string, unknown> {
  const record = asRecord(snapshot);

  return {
    ...record,
    cancelRequestedAt: input.cancelRequestedAt,
    cancelRequestedBy: input.cancelRequestedBy,
    ...(input.cancelRequestedByUserId
      ? { cancelRequestedByUserId: input.cancelRequestedByUserId }
      : {}),
    ...(input.cancelRequestedByRole ? { cancelRequestedByRole: input.cancelRequestedByRole } : {})
  };
}
