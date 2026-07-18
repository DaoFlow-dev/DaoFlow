import { TRPCError } from "@trpc/server";
import type { AppRole } from "@daoflow/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import { backupPolicies, backupRuns, volumes } from "../db/schema/storage";
import { resolveMemberTeamIdForUser } from "../db/services/teams";
import { backupDestinations } from "../db/schema/destinations";
import { resolveVolumeTeamId } from "../db/services/backup-resource-team";

type BackupScopeContext = {
  session: { user: { id: string; email: string } };
  auth: { role: AppRole; method?: string };
};

async function recordDeniedBackupAccess(input: {
  ctx: BackupScopeContext;
  action: string;
  permissionScope: string;
  resourceType: "backup-destination" | "backup-policy" | "backup-run" | "volume";
}) {
  await db.insert(auditEntries).values({
    actorType: input.ctx.auth.method === "api-token" ? "token" : "user",
    actorId: input.ctx.session.user.id,
    actorEmail: input.ctx.session.user.email,
    actorRole: input.ctx.auth.role,
    targetResource: `${input.resourceType}/cross-team`,
    action: input.action,
    inputSummary: "Denied cross-team backup access.",
    permissionScope: input.permissionScope,
    outcome: "denied",
    metadata: {
      resourceType: input.resourceType,
      detail: "Cross-team backup access was denied."
    }
  });
}

async function requireTeamId(userId: string) {
  const teamId = await resolveMemberTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }
  return teamId;
}

async function volumeBelongsToTeam(volume: typeof volumes.$inferSelect, teamId: string) {
  return (await resolveVolumeTeamId(volume)) === teamId;
}

export async function assertVolumeScope(input: {
  ctx: BackupScopeContext;
  volumeId: string;
  action: string;
  permissionScope: string;
}) {
  const teamId = await requireTeamId(input.ctx.session.user.id);
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, input.volumeId)).limit(1);
  if (!volume) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Volume not found." });
  }

  if (!(await volumeBelongsToTeam(volume, teamId))) {
    await recordDeniedBackupAccess({ ...input, resourceType: "volume" });
    throw new TRPCError({ code: "NOT_FOUND", message: "Volume not found." });
  }
}

export async function assertBackupDestinationScope(input: {
  ctx: BackupScopeContext;
  destinationId: string;
  action: string;
  permissionScope: string;
}) {
  const teamId = await requireTeamId(input.ctx.session.user.id);
  const [destination] = await db
    .select({ id: backupDestinations.id })
    .from(backupDestinations)
    .where(
      and(eq(backupDestinations.id, input.destinationId), eq(backupDestinations.teamId, teamId))
    )
    .limit(1);
  if (!destination) {
    await recordDeniedBackupAccess({ ...input, resourceType: "backup-destination" });
    throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
  }
}

export async function assertBackupPolicyScope(input: {
  ctx: BackupScopeContext;
  policyId: string;
  action: string;
  permissionScope: string;
}) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, input.policyId))
    .limit(1);
  if (!policy) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Backup policy not found." });
  }

  try {
    await assertVolumeScope({ ...input, volumeId: policy.volumeId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      await recordDeniedBackupAccess({ ...input, resourceType: "backup-policy" });
    }
    throw error;
  }
}

export async function assertBackupRunScope(input: {
  ctx: BackupScopeContext;
  backupRunId: string;
  action: string;
  permissionScope: string;
}) {
  const [run] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.id, input.backupRunId))
    .limit(1);
  if (!run) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Backup run not found." });
  }

  try {
    await assertBackupPolicyScope({ ...input, policyId: run.policyId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      await recordDeniedBackupAccess({ ...input, resourceType: "backup-run" });
    }
    throw error;
  }
}
