import { TRPCError } from "@trpc/server";
import { appRoles, defaultSignupRole } from "@daoflow/shared";
import { z } from "zod";
import { runOperationalMaintenanceOnce } from "../db/services/operational-maintenance";
import {
  createTeamInvite,
  inviteableUserRoles,
  listMemberAccessInventory
} from "../db/services/member-access";
import { listApiTokenInventory } from "../db/services/tokens";
import {
  t,
  protectedProcedure,
  adminProcedure,
  membersManageProcedure,
  getActorContext,
  serverWriteProcedure
} from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const adminRouter = t.router({
  viewer: protectedProcedure.query(({ ctx }) => {
    return {
      principal: ctx.auth.principal,
      session:
        ctx.auth.method === "session"
          ? {
              id: ctx.session.session.id,
              expiresAt: ctx.session.session.expiresAt
            }
          : null,
      authz: {
        authMethod: ctx.auth.method,
        stack:
          ctx.auth.method === "session"
            ? "Better Auth session + tRPC protected procedure"
            : "Bearer API token + tRPC protected procedure",
        intent:
          ctx.auth.method === "session"
            ? "human session auth for the control plane"
            : "scoped automation auth for CLI, CI, and agent access",
        role: ctx.auth.role,
        capabilities: [...ctx.auth.capabilities],
        token: ctx.auth.token
      }
    };
  }),
  adminControlPlane: adminProcedure.query(({ ctx }) => ({
    operator: {
      userId: ctx.auth.principal.linkedUserId ?? ctx.session.user.id,
      email: ctx.auth.principal.email,
      role: ctx.role
    },
    governance: {
      roles: appRoles,
      bootstrapRole: "owner" as const,
      defaultSignupRole,
      elevatedRoles: ["owner", "admin"] as const
    },
    capabilities: [...ctx.auth.capabilities],
    guardrails: [
      "External agents stay read-heavy by default.",
      "Destructive actions require narrower capability lanes.",
      "High-risk commands should move through explicit approval gates.",
      "Terminal-style access is not part of the default control plane."
    ]
  })),
  agentTokenInventory: adminProcedure.query(async () => {
    return listApiTokenInventory();
  }),
  runOperationalMaintenance: serverWriteProcedure
    .input(
      z.object({
        dryRun: z.boolean().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      return runOperationalMaintenanceOnce({
        ...getActorContext(ctx),
        dryRun: input.dryRun === true,
        trigger: "manual"
      });
    }),
  principalInventory: membersManageProcedure.query(async ({ ctx }) => {
    const actorUserId = ctx.auth.principal.linkedUserId ?? ctx.session.user.id;
    const teamId = await requireActorTeamId(actorUserId);
    return listMemberAccessInventory(teamId);
  }),
  inviteUser: membersManageProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(320),
        role: z.enum(inviteableUserRoles)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actorUserId = ctx.auth.principal.linkedUserId ?? ctx.session.user.id;
      const teamId = await requireActorTeamId(actorUserId);
      const result = await createTeamInvite({
        teamId,
        inviterId: actorUserId,
        email: input.email,
        role: input.role
      });

      if (result.status === "existing-user") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "That email already belongs to an existing DaoFlow user. Role changes for existing accounts are not part of invites yet."
        });
      }

      return result.invite;
    })
});
