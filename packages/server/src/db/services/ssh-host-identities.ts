import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { sshHostIdentities } from "../schema/ssh-host-identities";
import { newId } from "./json-helpers";
import {
  getServerForSshHostIdentityTeam,
  getSshHostIdentityRows,
  summarizeSshHostIdentity
} from "./ssh-host-identity-store";
import {
  recordSshHostIdentityObservationAudit,
  type SshHostIdentityActor
} from "./ssh-host-identity-audit";
import {
  scanSshHostKeys,
  isSupportedSshHostKeyAlgorithm,
  sshHostKeyFingerprint,
  type ObservedSshHostKey,
  type SshHostKeyScanner
} from "../../worker/ssh-host-key-scan";

export interface ExactSshHostKeySelection {
  identityId: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
}

class SshHostIdentityTransitionError extends Error {
  constructor(readonly status: "approval_required" | "selection_mismatch") {
    super(status);
    this.name = "SshHostIdentityTransitionError";
  }
}

function isConstraintViolation(error: unknown, constraint: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

function selectionMatches(
  identity: typeof sshHostIdentities.$inferSelect,
  selection: ExactSshHostKeySelection
): boolean {
  try {
    return (
      identity.id === selection.identityId &&
      identity.algorithm === selection.algorithm &&
      identity.publicKey === selection.publicKey &&
      identity.fingerprint === selection.fingerprint &&
      sshHostKeyFingerprint(selection.publicKey) === selection.fingerprint
    );
  } catch {
    return false;
  }
}

export async function listServerSshHostIdentities(serverId: string, teamId: string) {
  const server = await getServerForSshHostIdentityTeam(serverId, teamId);
  if (!server) return null;

  const rows = await getSshHostIdentityRows(serverId, teamId);
  const approved = rows.find((row) => row.status === "approved") ?? null;
  return {
    serverId,
    approved: approved ? summarizeSshHostIdentity(approved) : null,
    identities: rows.map(summarizeSshHostIdentity)
  };
}

export async function discoverServerSshHostIdentities(input: {
  serverId: string;
  teamId: string;
  actor?: SshHostIdentityActor;
  scan?: SshHostKeyScanner;
}) {
  const server = await getServerForSshHostIdentityTeam(input.serverId, input.teamId);
  if (!server) return null;

  const scanned = await (input.scan ?? scanSshHostKeys)({
    host: server.host,
    port: server.sshPort
  });
  const observed = scanned.filter((key) => {
    try {
      return (
        isSupportedSshHostKeyAlgorithm(key.algorithm) &&
        sshHostKeyFingerprint(key.publicKey) === key.fingerprint
      );
    } catch {
      return false;
    }
  });
  if (observed.length === 0) {
    throw new Error("No SSH host keys were discovered for this server.");
  }

  const observedAt = new Date();
  for (const key of observed) {
    await db
      .insert(sshHostIdentities)
      .values({
        id: newId(),
        teamId: input.teamId,
        serverId: input.serverId,
        algorithm: key.algorithm,
        publicKey: key.publicKey,
        fingerprint: key.fingerprint,
        status: "observed",
        observedAt,
        lastObservedAt: observedAt,
        updatedAt: observedAt
      })
      .onConflictDoUpdate({
        target: [
          sshHostIdentities.serverId,
          sshHostIdentities.algorithm,
          sshHostIdentities.fingerprint
        ],
        set: { lastObservedAt: observedAt, updatedAt: observedAt }
      });
  }

  const result = await listServerSshHostIdentities(input.serverId, input.teamId);
  if (!result) return null;
  const approvedMatches = result.approved
    ? observed.some(
        (key) =>
          key.algorithm === result.approved!.algorithm &&
          key.publicKey === result.approved!.publicKey &&
          key.fingerprint === result.approved!.fingerprint
      )
    : false;

  if (input.actor) {
    await recordSshHostIdentityObservationAudit({
      actor: input.actor,
      server,
      observedFingerprints: observed.map((key) => key.fingerprint),
      verification: result.approved ? (approvedMatches ? "match" : "mismatch") : "unapproved"
    });
  }

  return {
    ...result,
    verification: result.approved ? (approvedMatches ? "match" : "mismatch") : "unapproved"
  };
}

export async function approveServerSshHostIdentity(input: {
  serverId: string;
  teamId: string;
  selection: ExactSshHostKeySelection;
  actor: SshHostIdentityActor;
}) {
  const server = await getServerForSshHostIdentityTeam(input.serverId, input.teamId);
  if (!server) return { status: "not_found" as const };

  const [identity] = await db
    .select()
    .from(sshHostIdentities)
    .where(
      and(
        eq(sshHostIdentities.id, input.selection.identityId),
        eq(sshHostIdentities.serverId, input.serverId),
        eq(sshHostIdentities.teamId, input.teamId)
      )
    )
    .limit(1);
  if (!identity || !selectionMatches(identity, input.selection) || identity.status !== "observed") {
    return { status: "selection_mismatch" as const };
  }

  const rows = await getSshHostIdentityRows(input.serverId, input.teamId);
  if (rows.some((row) => row.status === "approved")) {
    return { status: "rotation_required" as const };
  }

  const approvedAt = new Date();
  let approved: typeof sshHostIdentities.$inferSelect | null;
  try {
    approved = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(sshHostIdentities)
        .set({
          status: "approved",
          approvedAt,
          approvedByUserId: input.actor.requestedByUserId,
          updatedAt: approvedAt
        })
        .where(
          and(
            eq(sshHostIdentities.id, identity.id),
            eq(sshHostIdentities.serverId, input.serverId),
            eq(sshHostIdentities.teamId, input.teamId),
            eq(sshHostIdentities.status, "observed")
          )
        )
        .returning();
      if (!updated) return null;

      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: input.actor.requestedByUserId,
        actorEmail: input.actor.requestedByEmail,
        actorRole: input.actor.requestedByRole,
        organizationId: server.teamId,
        targetResource: `server/${server.id}`,
        action: "server.ssh-host-identity.approve",
        inputSummary: `Approved SSH host identity ${updated.fingerprint} for ${server.name}.`,
        permissionScope: "server:write",
        outcome: "success",
        metadata: {
          resourceType: "server",
          resourceId: server.id,
          resourceLabel: server.name,
          algorithm: updated.algorithm,
          newFingerprint: updated.fingerprint
        }
      });
      return updated;
    });
  } catch (error) {
    if (isConstraintViolation(error, "ssh_host_identities_active_server_idx")) {
      return { status: "rotation_required" as const };
    }
    throw error;
  }
  if (!approved) return { status: "selection_mismatch" as const };
  return { status: "approved" as const, identity: summarizeSshHostIdentity(approved), server };
}

export async function rotateServerSshHostIdentity(input: {
  serverId: string;
  teamId: string;
  selection: ExactSshHostKeySelection;
  actor: SshHostIdentityActor;
}) {
  const server = await getServerForSshHostIdentityTeam(input.serverId, input.teamId);
  if (!server) return { status: "not_found" as const };

  const rows = await getSshHostIdentityRows(input.serverId, input.teamId);
  const previous = rows.find((row) => row.status === "approved");
  const selected = rows.find((row) => row.id === input.selection.identityId);
  if (!selected || !selectionMatches(selected, input.selection) || selected.status !== "observed") {
    return { status: "selection_mismatch" as const };
  }
  if (!previous) return { status: "approval_required" as const };

  const rotatedAt = new Date();
  let transition: {
    previous: typeof sshHostIdentities.$inferSelect;
    selected: typeof sshHostIdentities.$inferSelect;
  };
  try {
    transition = await db.transaction(async (tx) => {
      const [superseded] = await tx
        .update(sshHostIdentities)
        .set({
          status: "superseded",
          supersededAt: rotatedAt,
          supersededByUserId: input.actor.requestedByUserId,
          updatedAt: rotatedAt
        })
        .where(
          and(
            eq(sshHostIdentities.id, previous.id),
            eq(sshHostIdentities.serverId, input.serverId),
            eq(sshHostIdentities.teamId, input.teamId),
            eq(sshHostIdentities.status, "approved")
          )
        )
        .returning();
      if (!superseded) throw new SshHostIdentityTransitionError("approval_required");

      const [approved] = await tx
        .update(sshHostIdentities)
        .set({
          status: "approved",
          approvedAt: rotatedAt,
          approvedByUserId: input.actor.requestedByUserId,
          updatedAt: rotatedAt
        })
        .where(
          and(
            eq(sshHostIdentities.id, selected.id),
            eq(sshHostIdentities.serverId, input.serverId),
            eq(sshHostIdentities.teamId, input.teamId),
            eq(sshHostIdentities.status, "observed")
          )
        )
        .returning();
      if (!approved) throw new SshHostIdentityTransitionError("selection_mismatch");

      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: input.actor.requestedByUserId,
        actorEmail: input.actor.requestedByEmail,
        actorRole: input.actor.requestedByRole,
        organizationId: server.teamId,
        targetResource: `server/${server.id}`,
        action: "server.ssh-host-identity.rotate",
        inputSummary: `Rotated SSH host identity for ${server.name} from ${superseded.fingerprint} to ${approved.fingerprint}.`,
        permissionScope: "server:write",
        outcome: "success",
        metadata: {
          resourceType: "server",
          resourceId: server.id,
          resourceLabel: server.name,
          oldAlgorithm: superseded.algorithm,
          oldFingerprint: superseded.fingerprint,
          newAlgorithm: approved.algorithm,
          newFingerprint: approved.fingerprint
        }
      });
      return { previous: superseded, selected: approved };
    });
  } catch (error) {
    if (error instanceof SshHostIdentityTransitionError) {
      return { status: error.status };
    }
    if (isConstraintViolation(error, "ssh_host_identities_active_server_idx")) {
      return { status: "selection_mismatch" as const };
    }
    throw error;
  }
  return {
    status: "rotated" as const,
    server,
    oldIdentity: summarizeSshHostIdentity(transition.previous),
    identity: summarizeSshHostIdentity(transition.selected)
  };
}

export async function getApprovedSshHostIdentity(serverId: string, teamId: string) {
  const [identity] = await db
    .select()
    .from(sshHostIdentities)
    .where(
      and(
        eq(sshHostIdentities.serverId, serverId),
        eq(sshHostIdentities.teamId, teamId),
        eq(sshHostIdentities.status, "approved")
      )
    )
    .limit(1);
  return identity ?? null;
}

export function toManagedSshHostIdentity(identity: typeof sshHostIdentities.$inferSelect) {
  return {
    teamId: identity.teamId,
    serverId: identity.serverId,
    algorithm: identity.algorithm,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint
  };
}

export type { ObservedSshHostKey, SshHostIdentityActor, SshHostKeyScanner };
