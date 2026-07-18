import type { AppRole } from "@daoflow/shared";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupDestinations } from "../schema/destinations";
import { backupPolicies } from "../schema/storage";
import { testConnection } from "../../worker/rclone-executor";
import { newId as id } from "./json-helpers";
import {
  sanitizeOauthToken,
  toDestinationConfig,
  toPublicDestinationView,
  type CreateDestinationInput,
  type UpdateDestinationInput
} from "./destination-shared";

export type { CreateDestinationInput, UpdateDestinationInput } from "./destination-shared";

export async function listDestinations(teamId: string, limit = 50) {
  const rows = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.teamId, teamId))
    .orderBy(desc(backupDestinations.createdAt))
    .limit(limit);

  return rows.map(toPublicDestinationView);
}

export async function getDestination(destinationId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .limit(1);

  return row ? toPublicDestinationView(row) : null;
}

export async function getDestinationConfig(destinationId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .limit(1);

  return row ? toDestinationConfig(row) : null;
}

export async function createDestination(
  input: CreateDestinationInput,
  teamId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const destId = id();
  const now = new Date();
  const sanitizedOauthToken = sanitizeOauthToken(input.oauthToken) ?? null;
  const [row] = await db
    .insert(backupDestinations)
    .values({
      id: destId,
      teamId,
      name: input.name,
      provider: input.provider,
      accessKey: input.accessKey ?? null,
      secretAccessKey: input.secretAccessKey ?? null,
      bucket: input.bucket ?? null,
      region: input.region ?? null,
      endpoint: input.endpoint ?? null,
      s3Provider: input.s3Provider ?? null,
      rcloneType: input.rcloneType ?? null,
      rcloneConfig: input.rcloneConfig ?? null,
      rcloneRemotePath: input.rcloneRemotePath ?? null,
      oauthToken: sanitizedOauthToken,
      localPath: input.localPath ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  await writeDestinationAudit({
    userId,
    email,
    role,
    destinationId: destId,
    action: "destination.create",
    row
  });
  return toPublicDestinationView(row);
}

export async function updateDestination(
  input: UpdateDestinationInput,
  teamId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    "name",
    "provider",
    "accessKey",
    "secretAccessKey",
    "bucket",
    "region",
    "endpoint",
    "s3Provider",
    "rcloneType",
    "rcloneConfig",
    "rcloneRemotePath",
    "localPath"
  ] as const) {
    if (input[key] !== undefined) updateData[key] = input[key];
  }
  if (input.oauthToken !== undefined) updateData.oauthToken = sanitizeOauthToken(input.oauthToken);

  const [row] = await db
    .update(backupDestinations)
    .set(updateData)
    .where(and(eq(backupDestinations.id, input.id), eq(backupDestinations.teamId, teamId)))
    .returning();
  if (!row) return null;

  await writeDestinationAudit({
    userId,
    email,
    role,
    destinationId: input.id,
    action: "destination.update",
    row
  });
  return toPublicDestinationView(row);
}

export async function deleteDestination(
  destinationId: string,
  teamId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [destination] = await db
    .select({ id: backupDestinations.id })
    .from(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .limit(1);
  if (!destination) return { deleted: false, error: "Destination not found." };

  const [linkedPolicy] = await db
    .select({ id: backupPolicies.id })
    .from(backupPolicies)
    .where(eq(backupPolicies.destinationId, destinationId))
    .limit(1);
  if (linkedPolicy) {
    return {
      deleted: false,
      error: "Cannot delete: destination is used by one or more backup policies."
    };
  }

  const [deleted] = await db
    .delete(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .returning();
  if (!deleted) return { deleted: false, error: "Destination not found." };

  await writeDestinationAudit({
    userId,
    email,
    role,
    destinationId,
    action: "destination.delete",
    row: deleted
  });
  return { deleted: true, error: null };
}

export async function testDestinationConnection(destinationId: string, teamId: string) {
  const config = await getDestinationConfig(destinationId, teamId);
  if (!config) return { success: false, error: "Destination not found." };

  const result = testConnection(config);
  await db
    .update(backupDestinations)
    .set({
      lastTestedAt: new Date(),
      lastTestResult: result.success ? "success" : "failed",
      updatedAt: new Date()
    })
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)));

  return { success: result.success, output: result.output, error: result.error ?? null };
}

async function writeDestinationAudit(input: {
  userId: string;
  email: string;
  role: AppRole;
  destinationId: string;
  action: "destination.create" | "destination.update" | "destination.delete";
  row: typeof backupDestinations.$inferSelect;
}) {
  const verb = input.action.split(".")[1];
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.userId,
    actorEmail: input.email,
    actorRole: input.role,
    organizationId: input.row.teamId,
    targetResource: `backup-destination/${input.destinationId}`,
    action: input.action,
    inputSummary: `${verb[0]?.toUpperCase()}${verb.slice(1)}d backup destination "${input.row.name}".`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-destination",
      resourceId: input.destinationId,
      resourceLabel: input.row.name,
      detail: `Provider: ${input.row.provider}`,
      teamId: input.row.teamId
    }
  });
}
