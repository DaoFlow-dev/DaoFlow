import { appRoles, defaultSignupRole, normalizeAppRole, roleCapabilities } from "@daoflow/shared";
import {
  ensureControlPlaneReady,
  listApiTokenInventory,
  listPrincipalInventory
} from "../control-plane-db";
import { t, protectedProcedure, adminProcedure } from "../trpc";

export const adminRouter = t.router({
  viewer: protectedProcedure.query(({ ctx }) => {
    const role = normalizeAppRole((ctx.session.user as Record<string, unknown>).role);

    return {
      user: {
        id: ctx.session.user.id,
        email: ctx.session.user.email,
        name: ctx.session.user.name ?? null
      },
      session: {
        id: ctx.session.session.id,
        expiresAt: ctx.session.session.expiresAt
      },
      authz: {
        stack: "Better Auth + tRPC protected procedure",
        intent: "human session auth for the control plane",
        role,
        capabilities: roleCapabilities[role]
      }
    };
  }),
  adminControlPlane: adminProcedure.query(({ ctx }) => ({
    operator: {
      userId: ctx.session.user.id,
      email: ctx.session.user.email,
      role: ctx.role
    },
    governance: {
      roles: appRoles,
      bootstrapRole: "owner" as const,
      defaultSignupRole,
      elevatedRoles: ["owner", "admin"] as const
    },
    capabilities: roleCapabilities[ctx.role],
    guardrails: [
      "External agents stay read-heavy by default.",
      "Destructive actions require narrower capability lanes.",
      "High-risk commands should move through explicit approval gates.",
      "Terminal-style access is not part of the default control plane."
    ]
  })),
  agentTokenInventory: adminProcedure.query(async () => {
    await ensureControlPlaneReady();
    return listApiTokenInventory();
  }),
  principalInventory: adminProcedure.query(async () => {
    await ensureControlPlaneReady();
    return listPrincipalInventory();
  })
});
