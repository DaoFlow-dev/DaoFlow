/**
 * destinations.ts — Service layer for backup destination CRUD.
 *
 * Handles create, read, update, delete, and test operations for
 * backup destinations. Secrets are stored as-is for MVP; future
 * enhancement: AES-256-GCM encryption via env-configured key.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations, type BackupProvider } from "../schema/destinations";
import { backupPolicies } from "../schema/storage";
import { auditEntries } from "../schema/audit";
import { testConnection, type DestinationConfig } from "../../worker/rclone-executor";
import { newId as id } from "./json-helpers";
import type { AppRole } from "@daoflow/shared";

// ── Types ────────────────────────────────────────────────────

type DestinationRow = typeof backupDestinations.$inferSelect;

export interface CreateDestinationInput {
  name: string;
  provider: BackupProvider;
  // S3
  accessKey?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  s3Provider?: string;
  // Rclone
  rcloneType?: string;
  rcloneConfig?: string;
  rcloneRemotePath?: string;
  // OAuth
  oauthToken?: string;
  // Local
  localPath?: string;
}

export interface UpdateDestinationInput extends Partial<CreateDestinationInput> {
  id: string;
}

// ── Helpers ──────────────────────────────────────────────────

function rowToConfig(row: DestinationRow): DestinationConfig {
  return {
    id: row.id,
    provider: row.provider as BackupProvider,
    accessKey: row.accessKey,
    secretAccessKey: row.secretAccessKey,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneConfig: row.rcloneConfig,
    rcloneRemotePath: row.rcloneRemotePath,
    oauthToken: row.oauthToken,
    localPath: row.localPath
  };
}

/**
 * Mask secrets for safe display — only show last 4 chars.
 */
function maskSecret(value: string | null): string | null {
  if (!value || value.length < 8) return value ? "****" : null;
  return "****" + value.slice(-4);
}

function toPublicView(row: DestinationRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    // S3 — masked secrets
    accessKey: maskSecret(row.accessKey),
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    // Rclone
    rcloneType: row.rcloneType,
    rcloneRemotePath: row.rcloneRemotePath,
    // Local
    localPath: row.localPath,
    // Status
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

// ── CRUD Operations ──────────────────────────────────────────

export async function listDestinations(limit = 50) {
  const rows = await db
    .select()
    .from(backupDestinations)
    .orderBy(desc(backupDestinations.createdAt))
    .limit(limit);

  return rows.map(toPublicView);
}

export async function getDestination(destinationId: string) {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .limit(1);

  return row ? toPublicView(row) : null;
}

export async function createDestination(
  input: CreateDestinationInput,
  userId: string,
  email: string,
  role: AppRole
) {
  const destId = id();
  const now = new Date();

  // Compress OAuth tokens to single-line JSON to prevent rclone INI parser breakage
  let sanitizedOauthToken = input.oauthToken ?? null;
  if (sanitizedOauthToken) {
    try {
      sanitizedOauthToken = JSON.stringify(JSON.parse(sanitizedOauthToken));
    } catch {
      throw new Error("Invalid OAuth token: must be valid JSON from 'rclone authorize'.");
    }
  }

  const [row] = await db
    .insert(backupDestinations)
    .values({
      id: destId,
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

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-destination/${destId}`,
    action: "destination.create",
    inputSummary: `Created backup destination "${input.name}" (${input.provider}).`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-destination",
      resourceId: destId,
      resourceLabel: input.name,
      detail: `Provider: ${input.provider}`
    }
  });

  return toPublicView(row);
}

export async function updateDestination(
  input: UpdateDestinationInput,
  userId: string,
  email: string,
  role: AppRole
) {
  const now = new Date();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.provider !== undefined) updateData.provider = input.provider;
  if (input.accessKey !== undefined) updateData.accessKey = input.accessKey;
  if (input.secretAccessKey !== undefined) updateData.secretAccessKey = input.secretAccessKey;
  if (input.bucket !== undefined) updateData.bucket = input.bucket;
  if (input.region !== undefined) updateData.region = input.region;
  if (input.endpoint !== undefined) updateData.endpoint = input.endpoint;
  if (input.s3Provider !== undefined) updateData.s3Provider = input.s3Provider;
  if (input.rcloneType !== undefined) updateData.rcloneType = input.rcloneType;
  if (input.rcloneConfig !== undefined) updateData.rcloneConfig = input.rcloneConfig;
  if (input.rcloneRemotePath !== undefined) updateData.rcloneRemotePath = input.rcloneRemotePath;
  if (input.oauthToken !== undefined) updateData.oauthToken = input.oauthToken;
  if (input.localPath !== undefined) updateData.localPath = input.localPath;

  const [row] = await db
    .update(backupDestinations)
    .set(updateData)
    .where(eq(backupDestinations.id, input.id))
    .returning();

  if (!row) return null;

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-destination/${input.id}`,
    action: "destination.update",
    inputSummary: `Updated backup destination "${row.name}".`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-destination",
      resourceId: input.id,
      resourceLabel: row.name,
      detail: `Provider: ${row.provider}`
    }
  });

  return toPublicView(row);
}

export async function deleteDestination(
  destinationId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  // Check if any policies reference this destination
  const linkedPolicies = await db
    .select({ id: backupPolicies.id })
    .from(backupPolicies)
    .where(eq(backupPolicies.destinationId, destinationId))
    .limit(1);

  if (linkedPolicies.length > 0) {
    return {
      deleted: false,
      error: "Cannot delete: destination is used by one or more backup policies."
    };
  }

  const [deleted] = await db
    .delete(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .returning();

  if (!deleted) return { deleted: false, error: "Destination not found." };

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-destination/${destinationId}`,
    action: "destination.delete",
    inputSummary: `Deleted backup destination "${deleted.name}".`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-destination",
      resourceId: destinationId,
      resourceLabel: deleted.name,
      detail: `Provider: ${deleted.provider}`
    }
  });

  return { deleted: true, error: null };
}

// ── Test Connection ──────────────────────────────────────────

export async function testDestinationConnection(destinationId: string) {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .limit(1);

  if (!row) return { success: false, error: "Destination not found." };

  const config = rowToConfig(row);
  const result = testConnection(config);
  const now = new Date();

  // Update test result in DB
  await db
    .update(backupDestinations)
    .set({
      lastTestedAt: now,
      lastTestResult: result.success ? "success" : "failed",
      updatedAt: now
    })
    .where(eq(backupDestinations.id, destinationId));

  return {
    success: result.success,
    output: result.output,
    error: result.error ?? null
  };
}
