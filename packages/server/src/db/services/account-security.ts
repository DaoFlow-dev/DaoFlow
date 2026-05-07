import { eq, inArray } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { accountSecurityPolicies } from "../schema/account-security";
import { auditEntries } from "../schema/audit";
import { twoFactor } from "../schema/auth-schema";
import { teamMembers } from "../schema/teams";
import { users } from "../schema/users";

export const mfaRequirementValues = ["optional", "privileged", "all"] as const;
export type MfaRequirement = (typeof mfaRequirementValues)[number];

const privilegedRoles = ["owner", "admin", "operator"] as const;
const mfaEnrollmentSessionGraceMs = 30_000;

function normalizeMfaRequirement(value: string | null | undefined): MfaRequirement {
  return mfaRequirementValues.includes(value as MfaRequirement)
    ? (value as MfaRequirement)
    : "optional";
}

function requiresMfaForRole(requirement: MfaRequirement, role: AppRole) {
  if (requirement === "all") return role !== "agent";
  if (requirement === "privileged") return privilegedRoles.includes(role as never);
  return false;
}

async function getPolicyRow(teamId: string) {
  const [policy] = await db
    .select()
    .from(accountSecurityPolicies)
    .where(eq(accountSecurityPolicies.teamId, teamId))
    .limit(1);

  return policy ?? null;
}

export async function getAccountSecurityStatus(
  userId: string,
  role: AppRole,
  session?: {
    twoFactorEnabled?: boolean;
    createdAt?: Date | string | null;
  }
) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      defaultTeamId: users.defaultTeamId,
      twoFactorEnabled: users.twoFactorEnabled,
      mfaEnrolledAt: users.mfaEnrolledAt
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const teamId = user?.defaultTeamId ?? (await getFirstTeamIdForUser(userId));
  const policy = teamId ? await getPolicyRow(teamId) : null;
  const requirement = normalizeMfaRequirement(policy?.mfaRequirement);
  const recoveryCodesConfigured = await hasRecoveryCodesConfigured(userId);
  const required = requiresMfaForRole(requirement, role);
  const sessionMfaSatisfied =
    Boolean(session?.twoFactorEnabled) &&
    isSessionCurrentForMfa(session?.createdAt, user?.mfaEnrolledAt);

  return {
    teamId,
    policy: {
      mfaRequirement: requirement,
      updatedAt: policy?.updatedAt?.toISOString() ?? null,
      updatedByUserId: policy?.updatedByUserId ?? null
    },
    user: {
      id: user?.id ?? userId,
      email: user?.email ?? null,
      role,
      twoFactorEnabled: Boolean(user?.twoFactorEnabled),
      mfaRequired: required,
      mfaSatisfied: !required || sessionMfaSatisfied,
      recoveryCodesConfigured
    }
  };
}

export async function upsertAccountSecurityPolicy(input: {
  teamId: string;
  mfaRequirement: MfaRequirement;
  actorUserId: string;
  actorEmail: string;
  actorRole: AppRole;
}) {
  const updatedAt = new Date();
  await db
    .insert(accountSecurityPolicies)
    .values({
      teamId: input.teamId,
      mfaRequirement: input.mfaRequirement,
      updatedByUserId: input.actorUserId,
      updatedAt
    })
    .onConflictDoUpdate({
      target: accountSecurityPolicies.teamId,
      set: {
        mfaRequirement: input.mfaRequirement,
        updatedByUserId: input.actorUserId,
        updatedAt
      }
    });

  await recordAccountSecurityAudit({
    actorType: "user",
    actorId: input.actorUserId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    action: "security.mfa.policy.update",
    targetResource: `team/${input.teamId}`,
    outcome: "success",
    detail: `MFA policy changed to ${input.mfaRequirement}.`,
    metadata: {
      resourceType: "team",
      resourceId: input.teamId,
      mfaRequirement: input.mfaRequirement
    }
  });

  return getAccountSecurityStatus(input.actorUserId, input.actorRole);
}

export async function assertHumanMfaSatisfied(input: {
  userId: string;
  role: AppRole;
  twoFactorEnabled: boolean;
  sessionCreatedAt?: Date | string | null;
}) {
  const status = await getAccountSecurityStatus(input.userId, input.role, {
    twoFactorEnabled: input.twoFactorEnabled,
    createdAt: input.sessionCreatedAt
  });
  if (!status.user.mfaRequired || status.user.mfaSatisfied) {
    return;
  }

  return {
    code: "MFA_REQUIRED" as const,
    message: "Multi-factor authentication is required for this account before privileged access.",
    requirement: status.policy.mfaRequirement
  };
}

export async function recordMfaAuthEvent(input: {
  action: string;
  outcome: "success" | "failure";
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  detail: string;
  metadata?: Record<string, unknown>;
}) {
  await recordAccountSecurityAudit({
    actorType: "user",
    actorId: input.userId ?? "unknown",
    actorEmail: input.email ?? null,
    actorRole: input.role ?? null,
    action: input.action,
    targetResource: input.userId ? `user/${input.userId}` : "auth/mfa",
    outcome: input.outcome,
    detail: input.detail,
    metadata: {
      resourceType: "account-security",
      ...(input.userId ? { resourceId: input.userId } : {}),
      ...input.metadata
    }
  });
}

export async function markMfaEnrollmentSatisfied(userId: string) {
  await db
    .update(users)
    .set({
      mfaEnrolledAt: new Date(Date.now() - mfaEnrollmentSessionGraceMs)
    })
    .where(eq(users.id, userId));
}

export async function markMfaEnrollmentDisabled(userId: string) {
  await db.update(users).set({ mfaEnrolledAt: null }).where(eq(users.id, userId));
}

async function getFirstTeamIdForUser(userId: string) {
  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);

  return membership?.teamId ?? null;
}

async function hasRecoveryCodesConfigured(userId: string) {
  const [row] = await db
    .select({ backupCodes: twoFactor.backupCodes })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .limit(1);

  return Boolean(row?.backupCodes);
}

function isSessionCurrentForMfa(
  sessionCreatedAt: Date | string | null | undefined,
  mfaEnrolledAt: Date | null | undefined
) {
  if (!sessionCreatedAt || !mfaEnrolledAt) return false;
  const sessionTime =
    sessionCreatedAt instanceof Date
      ? sessionCreatedAt.getTime()
      : new Date(sessionCreatedAt).getTime();
  return Number.isFinite(sessionTime) && sessionTime >= mfaEnrolledAt.getTime();
}

async function recordAccountSecurityAudit(input: {
  actorType: "user" | "system";
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetResource: string;
  outcome: "success" | "failure";
  detail: string;
  metadata: Record<string, unknown>;
}) {
  await db.insert(auditEntries).values({
    actorType: input.actorType,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    targetResource: input.targetResource,
    action: input.action,
    inputSummary: input.detail,
    permissionScope: "members:manage",
    outcome: input.outcome,
    metadata: input.metadata
  });
}

export async function listMfaEnrollmentByUserIds(userIds: readonly string[]) {
  if (userIds.length === 0) return new Map<string, boolean>();

  const rows = await db
    .select({ id: users.id, twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.id, row.twoFactorEnabled]));
}
