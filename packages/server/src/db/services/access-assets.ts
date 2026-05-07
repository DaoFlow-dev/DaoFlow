import { createHash, createPublicKey } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { managedSshKeys } from "../schema/access-assets";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";

export interface AccessAssetActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

function hashMaterial(value: string) {
  return `sha256:${createHash("sha256").update(value.trim()).digest("base64url")}`;
}

function inferSshMetadata(privateKey: string) {
  try {
    const publicKey = createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    return {
      fingerprint: hashMaterial(publicKeyPem),
      keyType: publicKey.asymmetricKeyType ?? "unknown",
      publicKey: publicKeyPem
    };
  } catch {
    return {
      fingerprint: hashMaterial(privateKey),
      keyType: "unknown",
      publicKey: null
    };
  }
}

function serializeSshKey(row: typeof managedSshKeys.$inferSelect) {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    username: row.username,
    fingerprint: row.fingerprint,
    keyType: row.keyType,
    hasPrivateKey: Boolean(row.privateKeyEncrypted),
    status: row.status,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function recordAccessAssetAudit(input: {
  actor: AccessAssetActor;
  targetResource: string;
  action: string;
  summary: string;
  resourceType: "ssh-key" | "certificate" | "server";
  resourceId: string;
  resourceLabel: string;
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: input.targetResource,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceLabel: input.resourceLabel,
      detail: input.summary
    }
  });
}

export async function listManagedSshKeys(teamId: string) {
  const rows = await db
    .select()
    .from(managedSshKeys)
    .where(eq(managedSshKeys.teamId, teamId))
    .orderBy(desc(managedSshKeys.createdAt));
  return rows.map(serializeSshKey);
}

export async function createManagedSshKey(input: {
  teamId: string;
  name: string;
  username?: string | null;
  privateKey: string;
  actor: AccessAssetActor;
}) {
  const metadata = inferSshMetadata(input.privateKey);
  const [row] = await db
    .insert(managedSshKeys)
    .values({
      id: newId(),
      teamId: input.teamId,
      name: input.name,
      username: input.username ?? null,
      fingerprint: metadata.fingerprint,
      keyType: metadata.keyType,
      publicKey: metadata.publicKey,
      privateKeyEncrypted: encrypt(input.privateKey.trim()),
      createdByUserId: input.actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();
  const summary = `Created managed SSH key ${row.name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `ssh-key/${row.id}`,
    action: "ssh_key.create",
    summary,
    resourceType: "ssh-key",
    resourceId: row.id,
    resourceLabel: row.name
  });
  return serializeSshKey(row);
}

export async function rotateManagedSshKey(input: {
  teamId: string;
  keyId: string;
  privateKey: string;
  actor: AccessAssetActor;
}) {
  const existing = await db
    .select()
    .from(managedSshKeys)
    .where(and(eq(managedSshKeys.id, input.keyId), eq(managedSshKeys.teamId, input.teamId)))
    .limit(1);
  const current = existing[0];
  if (!current) return null;

  const metadata = inferSshMetadata(input.privateKey);
  const [row] = await db
    .update(managedSshKeys)
    .set({
      fingerprint: metadata.fingerprint,
      keyType: metadata.keyType,
      publicKey: metadata.publicKey,
      privateKeyEncrypted: encrypt(input.privateKey.trim()),
      rotatedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(managedSshKeys.id, input.keyId))
    .returning();
  const summary = `Rotated managed SSH key ${row.name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `ssh-key/${row.id}`,
    action: "ssh_key.rotate",
    summary,
    resourceType: "ssh-key",
    resourceId: row.id,
    resourceLabel: row.name
  });
  return serializeSshKey(row);
}

export async function deleteManagedSshKey(input: {
  teamId: string;
  keyId: string;
  actor: AccessAssetActor;
}) {
  const existing = await db
    .select()
    .from(managedSshKeys)
    .where(and(eq(managedSshKeys.id, input.keyId), eq(managedSshKeys.teamId, input.teamId)))
    .limit(1);
  const current = existing[0];
  if (!current) return null;

  await db
    .update(servers)
    .set({ sshKeyId: null, updatedAt: new Date() })
    .where(eq(servers.sshKeyId, input.keyId));
  await db.delete(managedSshKeys).where(eq(managedSshKeys.id, input.keyId));
  const summary = `Deleted managed SSH key ${current.name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `ssh-key/${current.id}`,
    action: "ssh_key.delete",
    summary,
    resourceType: "ssh-key",
    resourceId: current.id,
    resourceLabel: current.name
  });
  return { deleted: true as const, keyId: input.keyId };
}

export async function attachManagedSshKeyToServer(input: {
  teamId: string;
  keyId: string;
  serverId: string;
  actor: AccessAssetActor;
}) {
  const [key, server] = await Promise.all([
    db
      .select()
      .from(managedSshKeys)
      .where(and(eq(managedSshKeys.id, input.keyId), eq(managedSshKeys.teamId, input.teamId)))
      .limit(1),
    db.select().from(servers).where(eq(servers.id, input.serverId)).limit(1)
  ]);
  if (!key[0] || !server[0]) return null;

  const [updated] = await db
    .update(servers)
    .set({
      sshKeyId: input.keyId,
      sshPrivateKeyEncrypted: null,
      sshUser: key[0].username ?? server[0].sshUser,
      updatedAt: new Date()
    })
    .where(eq(servers.id, input.serverId))
    .returning();
  await db
    .update(managedSshKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(managedSshKeys.id, input.keyId));
  const summary = `Attached managed SSH key ${key[0].name} to server ${server[0].name}.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `server/${input.serverId}`,
    action: "ssh_key.attach",
    summary,
    resourceType: "server",
    resourceId: input.serverId,
    resourceLabel: server[0].name
  });
  return { server: updated, key: serializeSshKey(key[0]) };
}

export async function detachManagedSshKeyFromServer(input: {
  serverId: string;
  actor: AccessAssetActor;
}) {
  const [server] = await db.select().from(servers).where(eq(servers.id, input.serverId)).limit(1);
  if (!server) return null;

  const [updated] = await db
    .update(servers)
    .set({ sshKeyId: null, updatedAt: new Date() })
    .where(eq(servers.id, input.serverId))
    .returning();
  const summary = server.sshKeyId
    ? `Detached managed SSH key ${server.sshKeyId} from server ${server.name}.`
    : `Confirmed server ${server.name} has no managed SSH key attached.`;
  await recordAccessAssetAudit({
    actor: input.actor,
    targetResource: `server/${input.serverId}`,
    action: "ssh_key.detach",
    summary,
    resourceType: "server",
    resourceId: input.serverId,
    resourceLabel: server.name
  });
  return { server: updated, detachedKeyId: server.sshKeyId };
}

export async function resolveManagedSshPrivateKey(keyId: string) {
  const [key] = await db.select().from(managedSshKeys).where(eq(managedSshKeys.id, keyId)).limit(1);
  if (!key) return null;
  return decrypt(key.privateKeyEncrypted);
}
