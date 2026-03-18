import { appRoles, defaultSignupRole } from "@daoflow/shared";
import { listApiTokenInventory, listPrincipalInventory } from "../db/services/tokens";
import { t, protectedProcedure, adminProcedure } from "../trpc";

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
  principalInventory: adminProcedure.query(async () => {
    return listPrincipalInventory();
  })
});
