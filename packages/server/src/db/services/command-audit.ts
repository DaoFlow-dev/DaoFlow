import { createHash } from "node:crypto";
import type { TRPCError } from "@trpc/server";
import type { ApiTokenScope, AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { newId } from "./json-helpers";
import { resolveTeamIdForUser } from "./teams";

export const commandAuditOutcomes = [
  "attempted",
  "validation_failed",
  "denied",
  "approval_denied",
  "accepted",
  "succeeded",
  "execution_failed",
  "incomplete"
] as const;

export type CommandAuditOutcome = (typeof commandAuditOutcomes)[number];

export interface CommandAuditContract {
  version: 1;
  permissionScope: string;
  requiredScopes: readonly ApiTokenScope[];
  approvalRequired: boolean;
  idempotencyExpected: boolean;
}

export interface CommandAuditActor {
  type: "user" | "agent" | "service" | "token" | "anonymous";
  id: string;
  email: string | null;
  role: AppRole | null;
  linkedUserId: string | null;
}

export interface SafeCommandInputSummary {
  inputType: "array" | "null" | "object" | "primitive";
  providedFields: string[];
  targetKeys: string[];
}

export interface CommandAuditAttempt {
  id: string;
  action: string;
  targetResource: string;
  inputSummary: string;
  organizationId: string | null;
}

export interface PreparedCommandAuditAttempt {
  attempt: CommandAuditAttempt;
  actor: CommandAuditActor;
  contract: CommandAuditContract;
  consumed: boolean;
}

const ACCEPTED_COMMAND_PATHS = new Set([
  "approveApprovalRequest",
  "cancelDevelopmentTask",
  "cancelDeployment",
  "createDeploymentRecord",
  "createManagedDatabase",
  "dispatchExecutionJob",
  "executeRollback",
  "queueBackupRestore",
  "queueComposeRelease",
  "reconcileComposePreviews",
  "retryDevelopmentTask",
  "runServiceScheduleNow",
  "setManagedDatabaseState",
  "triggerBackupNow",
  "triggerBackupRun",
  "triggerControlPlaneRecoveryBundle",
  "triggerDeploy",
  "triggerTestRestore"
]);

const TARGET_KEY_PRIORITY = [
  "deploymentId",
  "serviceId",
  "environmentId",
  "projectId",
  "serverId",
  "taskId",
  "operationId",
  "jobId",
  "restoreId",
  "bundleId",
  "runId",
  "policyId",
  "volumeId",
  "destinationId",
  "registryId",
  "providerId",
  "agentId",
  "approvalId",
  "scheduleId",
  "keyId",
  "id"
] as const;

function asSafeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTargetType(key: string): string {
  const withoutId = key === "id" ? "resource" : key.replace(/Id$/, "");
  return withoutId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function readSafeIdentifier(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return null;
  }

  return /^[A-Za-z0-9._:@/+-]+$/.test(value) ? value : null;
}

export function summarizeCommandInput(
  rawInput: unknown,
  path: string
): {
  targetResource: string;
  summary: SafeCommandInputSummary;
} {
  const record = asSafeRecord(rawInput);
  if (!record) {
    return {
      targetResource: `command/${path}`,
      summary: {
        inputType: rawInput === null ? "null" : Array.isArray(rawInput) ? "array" : "primitive",
        providedFields: [],
        targetKeys: []
      }
    };
  }

  const providedFields = Object.keys(record).sort().slice(0, 100);
  const candidateKeys = [
    ...TARGET_KEY_PRIORITY,
    ...providedFields.filter(
      (key) => key.endsWith("Id") && !TARGET_KEY_PRIORITY.includes(key as never)
    )
  ];
  const targets = candidateKeys
    .map((key) => ({ key, value: readSafeIdentifier(record, key) }))
    .filter((target): target is { key: string; value: string } => target.value !== null);
  const primaryTarget = targets[0];

  return {
    targetResource: primaryTarget
      ? `${normalizeTargetType(primaryTarget.key)}/${primaryTarget.value}`
      : `command/${path}`,
    summary: {
      inputType: "object",
      providedFields,
      targetKeys: targets.map((target) => target.key)
    }
  };
}

export function hashIdempotencyKey(headers?: Headers): string | null {
  const key = headers?.get("idempotency-key") ?? headers?.get("x-idempotency-key");
  if (!key) {
    return null;
  }

  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

export function classifyCommandAuditError(
  error: TRPCError
): Exclude<CommandAuditOutcome, "attempted"> {
  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "denied";
  }

  const cause =
    error.cause && typeof error.cause === "object"
      ? (error.cause as unknown as Record<string, unknown>)
      : null;
  if (
    error.code === "BAD_REQUEST" &&
    (cause?.name === "ZodError" || Array.isArray(cause?.issues))
  ) {
    return "validation_failed";
  }

  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  if (causeCode.includes("APPROVAL") || /approval/i.test(error.message)) {
    return "approval_denied";
  }

  return "execution_failed";
}

export function successOutcomeForCommand(path: string): "accepted" | "succeeded" {
  return ACCEPTED_COMMAND_PATHS.has(path) ? "accepted" : "succeeded";
}

export function extractCommandOperationId(path: string, result: unknown): string | null {
  const root = asSafeRecord(result);
  if (!root) {
    return null;
  }

  const preferredContainer =
    path === "createManagedDatabase" || path === "setManagedDatabaseState" ? "deployment" : null;
  if (preferredContainer) {
    const preferred = asSafeRecord(root[preferredContainer]);
    const preferredId = preferred ? readSafeIdentifier(preferred, "id") : null;
    if (preferredId) return preferredId;
  }

  for (const containerKey of [
    "operation",
    "deployment",
    "job",
    "restore",
    "bundle",
    "run",
    "task"
  ]) {
    const record = asSafeRecord(root[containerKey]);
    const value = record ? readSafeIdentifier(record, "id") : null;
    if (value) return value;
  }

  const nestedRecords = Object.values(root)
    .map(asSafeRecord)
    .filter((record): record is Record<string, unknown> => record !== null);
  const records = [root, ...nestedRecords];
  for (const record of records) {
    for (const key of [
      "operationId",
      "deploymentId",
      "jobId",
      "restoreId",
      "bundleId",
      "runId",
      "taskId"
    ]) {
      const value = readSafeIdentifier(record, key);
      if (value) {
        return value;
      }
    }
  }

  return readSafeIdentifier(root, "id");
}

export async function beginCommandAudit(input: {
  path: string;
  requestId: string;
  actor: CommandAuditActor;
  contract: CommandAuditContract;
  rawInput: unknown;
  requestHeaders?: Headers;
}): Promise<CommandAuditAttempt> {
  const attemptId = newId();
  const action = `command.${input.path}`.slice(0, 80);
  const safeInput = summarizeCommandInput(input.rawInput, input.path);
  const organizationId = input.actor.linkedUserId
    ? await resolveTeamIdForUser(input.actor.linkedUserId)
    : null;
  const idempotencyKey = hashIdempotencyKey(input.requestHeaders);
  const inputSummary = JSON.stringify(safeInput.summary);

  await db.insert(auditEntries).values({
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    actorRole: input.actor.role,
    organizationId,
    targetResource: safeInput.targetResource,
    action,
    inputSummary,
    permissionScope: input.contract.permissionScope,
    outcome: "attempted",
    metadata: {
      immutable: true,
      commandAuditVersion: input.contract.version,
      attemptId,
      phase: "intent",
      requestId: input.requestId,
      path: input.path,
      requiredScopes: input.contract.requiredScopes,
      approvalRequired: input.contract.approvalRequired,
      idempotencyExpected: input.contract.idempotencyExpected,
      idempotencyKey
    }
  });

  return {
    id: attemptId,
    action,
    targetResource: safeInput.targetResource,
    inputSummary,
    organizationId
  };
}

export async function finishCommandAudit(input: {
  attempt: CommandAuditAttempt;
  requestId: string;
  actor: CommandAuditActor;
  contract: CommandAuditContract;
  outcome: Exclude<CommandAuditOutcome, "attempted">;
  result?: unknown;
  error?: TRPCError;
}): Promise<void> {
  const phase = input.outcome === "accepted" ? "acceptance" : "outcome";
  await db.insert(auditEntries).values({
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    actorRole: input.actor.role,
    organizationId: input.attempt.organizationId,
    targetResource: input.attempt.targetResource,
    action: input.attempt.action,
    inputSummary: input.error ? input.error.code : null,
    permissionScope: input.contract.permissionScope,
    outcome: input.outcome,
    metadata: {
      immutable: true,
      commandAuditVersion: input.contract.version,
      attemptId: input.attempt.id,
      phase,
      requestId: input.requestId,
      operationId: extractCommandOperationId(
        input.attempt.action.replace(/^command\./, ""),
        input.result
      ),
      errorCode: input.error?.code ?? null
    }
  });
}
