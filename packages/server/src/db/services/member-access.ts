import { randomUUID } from "node:crypto";
import type { AppRole } from "@daoflow/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../connection";
import { teamInvites, teamMembers } from "../schema/teams";
import { principals } from "../schema/tokens";
import { users } from "../schema/users";

export const inviteableUserRoles = ["admin", "operator", "developer", "viewer"] as const;

export type InviteableUserRole = (typeof inviteableUserRoles)[number];

const PENDING_INVITE_STATUS = "pending";
const DEFAULT_INVITE_TTL_DAYS = 7;

const membershipRoleByAppRole: Record<InviteableUserRole, "admin" | "member"> = {
  admin: "admin",
  operator: "member",
  developer: "member",
  viewer: "member"
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

type PendingInviteRecord = {
  id: string;
  teamId: string;
  email: string;
  role: InviteableUserRole;
  expiresAt: Date;
};

async function findExistingUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const [existingUser] = await db
    .select({
      id: users.id,
      email: users.email
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);

  return existingUser ?? null;
}

export async function findPendingTeamInviteByEmail(
  email: string
): Promise<PendingInviteRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  const [invite] = await db
    .select({
      id: teamInvites.id,
      teamId: teamInvites.teamId,
      email: teamInvites.email,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt
    })
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.status, PENDING_INVITE_STATUS),
        gt(teamInvites.expiresAt, new Date()),
        sql`lower(${teamInvites.email}) = ${normalizedEmail}`
      )
    )
    .orderBy(desc(teamInvites.createdAt))
    .limit(1);

  if (!invite || !inviteableUserRoles.includes(invite.role as InviteableUserRole)) {
    return null;
  }

  return {
    ...invite,
    role: invite.role as InviteableUserRole
  };
}

export async function createTeamInvite(input: {
  teamId: string;
  inviterId: string;
  email: string;
  role: InviteableUserRole;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const existingUser = await findExistingUserByEmail(normalizedEmail);

  if (existingUser) {
    return {
      status: "existing-user" as const,
      existingUser
    };
  }

  const expiresAt = new Date(Date.now() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const createdAt = new Date();

  const [existingInvite] = await db
    .select({ id: teamInvites.id })
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.teamId, input.teamId),
        eq(teamInvites.status, PENDING_INVITE_STATUS),
        sql`lower(${teamInvites.email}) = ${normalizedEmail}`
      )
    )
    .orderBy(desc(teamInvites.createdAt))
    .limit(1);

  if (existingInvite) {
    const [invite] = await db
      .update(teamInvites)
      .set({
        email: normalizedEmail,
        role: input.role,
        inviterId: input.inviterId,
        createdAt,
        expiresAt
      })
      .where(eq(teamInvites.id, existingInvite.id))
      .returning({
        id: teamInvites.id,
        email: teamInvites.email,
        role: teamInvites.role,
        createdAt: teamInvites.createdAt,
        expiresAt: teamInvites.expiresAt
      });

    return {
      status: "ok" as const,
      invite: {
        ...invite,
        role: invite.role as InviteableUserRole,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString()
      }
    };
  }

  const [invite] = await db
    .insert(teamInvites)
    .values({
      id: `inv_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
      teamId: input.teamId,
      email: normalizedEmail,
      role: input.role,
      status: PENDING_INVITE_STATUS,
      inviterId: input.inviterId,
      createdAt,
      expiresAt
    })
    .returning({
      id: teamInvites.id,
      email: teamInvites.email,
      role: teamInvites.role,
      createdAt: teamInvites.createdAt,
      expiresAt: teamInvites.expiresAt
    });

  return {
    status: "ok" as const,
    invite: {
      ...invite,
      role: invite.role as InviteableUserRole,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString()
    }
  };
}

export async function acceptPendingTeamInviteForUser(input: { userId: string; email: string }) {
  const invite = await findPendingTeamInviteByEmail(input.email);
  if (!invite) {
    return null;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        role: invite.role,
        defaultTeamId: invite.teamId,
        updatedAt: new Date()
      })
      .where(eq(users.id, input.userId));

    const [existingMembership] = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, input.userId)))
      .limit(1);

    if (!existingMembership) {
      await tx.insert(teamMembers).values({
        teamId: invite.teamId,
        userId: input.userId,
        role: membershipRoleByAppRole[invite.role],
        createdAt: new Date()
      });
    }

    await tx.update(teamInvites).set({ status: "accepted" }).where(eq(teamInvites.id, invite.id));
  });

  return invite;
}

export async function acceptPendingTeamInviteForEmail(email: string) {
  const existingUser = await findExistingUserByEmail(email);
  if (!existingUser) {
    return null;
  }

  return acceptPendingTeamInviteForUser({
    userId: existingUser.id,
    email: existingUser.email
  });
}

export async function listMemberAccessInventory(teamId: string) {
  const [memberRows, principalRows, inviteRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        type: sql<string>`'user'`,
        accessRole: users.role,
        status: users.status,
        createdAt: users.createdAt
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(desc(users.createdAt)),
    db
      .select({
        id: principals.id,
        name: principals.name,
        email: sql<string>`null`,
        type: principals.type,
        accessRole: sql<string>`case when ${principals.type} = 'service' then 'service' else 'agent' end`,
        status: principals.status,
        createdAt: principals.createdAt
      })
      .from(principals)
      .where(sql`${principals.type} <> 'user'`)
      .orderBy(desc(principals.createdAt)),
    db
      .select({
        id: teamInvites.id,
        email: teamInvites.email,
        role: teamInvites.role,
        invitedByEmail: users.email,
        expiresAt: teamInvites.expiresAt
      })
      .from(teamInvites)
      .innerJoin(users, eq(teamInvites.inviterId, users.id))
      .where(
        and(
          eq(teamInvites.teamId, teamId),
          eq(teamInvites.status, PENDING_INVITE_STATUS),
          gt(teamInvites.expiresAt, new Date())
        )
      )
      .orderBy(desc(teamInvites.createdAt))
  ]);

  return {
    principals: [...memberRows, ...principalRows].map((row) => ({
      id: row.id,
      name: row.name ?? row.email ?? row.id,
      email: row.email,
      type: row.type,
      accessRole: row.accessRole as AppRole | "service",
      status: row.status,
      createdAt: row.createdAt.toISOString()
    })),
    invites: inviteRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as InviteableUserRole,
      invitedByEmail: row.invitedByEmail,
      expiresAt: row.expiresAt.toISOString()
    }))
  };
}
