import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupPolicies, backupRuns } from "../schema/storage";
import { disableBackupSchedule, enableBackupSchedule } from "./backup-schedules";
import { newId as id } from "./json-helpers";
import {
  ensureVolumePolicySlot,
  findDestination,
  findPolicy,
  findVolume,
  syncVolumeBackupMetadata,
  toPolicyView,
  trimOrNull,
  type ActorContext,
  type CreateBackupPolicyInput,
  type UpdateBackupPolicyInput
} from "./storage-management-shared";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";

export async function createBackupPolicy(input: CreateBackupPolicyInput, actor: ActorContext) {
  const volume = await findVolume(input.volumeId);
  if (!volume) {
    return { status: "not-found" as const, entity: "volume" };
  }

  const conflictingPolicy = await ensureVolumePolicySlot(input.volumeId);
  if (conflictingPolicy) {
    return {
      status: "conflict" as const,
      message: "Each registered volume can only have one backup policy today."
    };
  }

  const destinationId = trimOrNull(input.destinationId);
  const destination = destinationId ? await findDestination(destinationId) : null;
  if (destinationId && !destination) {
    return { status: "not-found" as const, entity: "destination" };
  }

  const schedule = trimOrNull(input.schedule);
  if (schedule && !isTemporalEnabled()) {
    return {
      status: "precondition-failed" as const,
      message:
        "Backup schedules require Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true before enabling a schedule."
    };
  }

  const policyId = id();
  const now = new Date();

  await db.insert(backupPolicies).values({
    id: policyId,
    name: input.name,
    volumeId: input.volumeId,
    backupType: input.backupType ?? "volume",
    databaseEngine: input.databaseEngine ?? null,
    turnOff: input.turnOff ? 1 : 0,
    schedule: null,
    retentionDays: input.retentionDays ?? 30,
    retentionDaily: input.retentionDaily ?? 7,
    retentionWeekly: input.retentionWeekly ?? 4,
    retentionMonthly: input.retentionMonthly ?? 12,
    maxBackups: input.maxBackups ?? 100,
    destinationId,
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now
  });

  try {
    if (schedule) {
      await enableBackupSchedule(policyId, schedule, actor.userId, actor.email, actor.role);
    }

    await syncVolumeBackupMetadata(input.volumeId, policyId);

    const policy = await findPolicy(policyId);
    if (!policy) {
      return { status: "not-found" as const, entity: "policy" };
    }

    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetResource: `backup-policy/${policyId}`,
      action: "backup-policy.create",
      inputSummary: `Created backup policy ${policy.name}.`,
      permissionScope: "backup:run",
      outcome: "success",
      metadata: {
        resourceType: "backup-policy",
        resourceId: policyId,
        resourceLabel: policy.name,
        detail: `Volume ${volume.name}`
      }
    });

    return {
      status: "ok" as const,
      policy: toPolicyView(policy, volume, destination)
    };
  } catch (error) {
    await db.delete(backupPolicies).where(eq(backupPolicies.id, policyId));
    await syncVolumeBackupMetadata(input.volumeId, null);
    throw error;
  }
}

export async function updateBackupPolicy(input: UpdateBackupPolicyInput, actor: ActorContext) {
  const current = await findPolicy(input.policyId);
  if (!current) {
    return { status: "not-found" as const, entity: "policy" };
  }

  const nextVolumeId = trimOrNull(input.volumeId) ?? current.volumeId;
  const volume = await findVolume(nextVolumeId);
  if (!volume) {
    return { status: "not-found" as const, entity: "volume" };
  }

  const conflictingPolicy = await ensureVolumePolicySlot(nextVolumeId, current.id);
  if (conflictingPolicy) {
    return {
      status: "conflict" as const,
      message: "Each registered volume can only have one backup policy today."
    };
  }

  const nextDestinationId =
    input.destinationId !== undefined ? trimOrNull(input.destinationId) : current.destinationId;
  const destination = nextDestinationId ? await findDestination(nextDestinationId) : null;
  if (nextDestinationId && !destination) {
    return { status: "not-found" as const, entity: "destination" };
  }

  const nextSchedule = input.schedule !== undefined ? trimOrNull(input.schedule) : current.schedule;
  if (nextSchedule && !isTemporalEnabled()) {
    return {
      status: "precondition-failed" as const,
      message:
        "Backup schedules require Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true before enabling a schedule."
    };
  }

  await db
    .update(backupPolicies)
    .set({
      name: trimOrNull(input.name) ?? current.name,
      volumeId: nextVolumeId,
      backupType: input.backupType ?? current.backupType,
      databaseEngine:
        input.databaseEngine !== undefined ? input.databaseEngine : current.databaseEngine,
      turnOff: input.turnOff !== undefined ? (input.turnOff ? 1 : 0) : current.turnOff,
      retentionDays: input.retentionDays ?? current.retentionDays,
      retentionDaily: input.retentionDaily ?? current.retentionDaily,
      retentionWeekly: input.retentionWeekly ?? current.retentionWeekly,
      retentionMonthly: input.retentionMonthly ?? current.retentionMonthly,
      maxBackups: input.maxBackups ?? current.maxBackups,
      destinationId: nextDestinationId,
      status: input.status ?? current.status,
      updatedAt: new Date()
    })
    .where(eq(backupPolicies.id, input.policyId));

  if (current.volumeId !== nextVolumeId) {
    await syncVolumeBackupMetadata(current.volumeId, null);
  }

  await syncVolumeBackupMetadata(nextVolumeId, current.id);

  if (nextSchedule !== current.schedule) {
    if (current.schedule && !nextSchedule) {
      await disableBackupSchedule(current.id, actor.userId, actor.email, actor.role);
    } else if (nextSchedule) {
      await enableBackupSchedule(current.id, nextSchedule, actor.userId, actor.email, actor.role);
    }
  }

  const policy = await findPolicy(current.id);
  if (!policy) {
    return { status: "not-found" as const, entity: "policy" };
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    targetResource: `backup-policy/${current.id}`,
    action: "backup-policy.update",
    inputSummary: `Updated backup policy ${policy.name}.`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: current.id,
      resourceLabel: policy.name,
      detail: `Volume ${volume.name}`
    }
  });

  return {
    status: "ok" as const,
    policy: toPolicyView(policy, volume, destination)
  };
}

export async function deleteBackupPolicy(policyId: string, actor: ActorContext) {
  const policy = await findPolicy(policyId);
  if (!policy) {
    return { status: "not-found" as const, entity: "policy" };
  }

  const [existingRun] = await db
    .select({ id: backupRuns.id })
    .from(backupRuns)
    .where(eq(backupRuns.policyId, policyId))
    .limit(1);
  if (existingRun) {
    return {
      status: "has-dependencies" as const,
      message: "This policy already has backup runs recorded and cannot be deleted."
    };
  }

  if (policy.schedule) {
    await disableBackupSchedule(policy.id, actor.userId, actor.email, actor.role);
  }

  await db.delete(backupPolicies).where(eq(backupPolicies.id, policyId));
  await syncVolumeBackupMetadata(policy.volumeId, null);

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup-policy.delete",
    inputSummary: `Deleted backup policy ${policy.name}.`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `Volume ${policy.volumeId}`
    }
  });

  return { status: "ok" as const, deleted: true };
}
