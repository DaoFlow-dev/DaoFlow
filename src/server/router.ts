import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  appRoles,
  canAssumeAnyRole,
  defaultSignupRole,
  normalizeAppRole,
  roleCapabilities,
  type AppRole
} from "../shared/authz";
import {
  createDeploymentRecord,
  ensureControlPlaneReady,
  listApiTokenInventory,
  getDeploymentRecord,
  listDeploymentRecords
} from "./control-plane-db";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to access this procedure."
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session
    }
  });
});
const roleProcedure = (allowedRoles: readonly AppRole[]) =>
  protectedProcedure.use(({ ctx, next }) => {
    const role = normalizeAppRole((ctx.session.user as Record<string, unknown>).role);

    if (!canAssumeAnyRole(role, allowedRoles)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role is not allowed to access this procedure."
      });
    }

    return next({
      ctx: {
        ...ctx,
        role
      }
    });
  });
const adminProcedure = roleProcedure(["owner", "admin"]);
const deployProcedure = roleProcedure(["owner", "admin", "operator", "developer"]);

const productPrinciples = [
  "Safety before autonomy",
  "Compose-first before platform sprawl",
  "Transparent infrastructure before magic",
  "Auditability before convenience"
] as const;

const agentApiLanes = [
  "read APIs",
  "planning APIs",
  "command APIs"
] as const;

export const appRouter = t.router({
  health: t.procedure.query(() => ({
    status: "healthy" as const,
    service: "daoflow-control-plane",
    timestamp: new Date().toISOString()
  })),
  platformOverview: t.procedure.query(() => ({
    name: "DaoFlow",
    currentSlice: "deployment-write-path",
    thesis:
      "A Docker-first deployment control plane for bare metal and VPS environments.",
    architecture: {
      controlPlane: ["React web UI", "tRPC API", "typed domain services"],
      executionPlane: [
        "Docker and Compose orchestration workers",
        "log and event collection",
        "backup and restore operations"
      ]
    },
    guardrails: {
      deploymentTargets: ["Docker Engine", "Docker Compose"],
      agentApiLanes,
      productPrinciples
    }
  })),
  roadmap: t.procedure
    .input(
      z.object({
        lane: z.enum(["control-plane", "execution-plane", "agent-safety"]).optional()
      })
    )
    .query(({ input }) => {
      const items = [
        {
          lane: "control-plane",
          title: "Typed deployment records",
          summary: "Track immutable deployments, structured steps, and outcomes."
        },
        {
          lane: "execution-plane",
          title: "SSH-backed Docker worker",
          summary: "Run Docker and Compose operations outside the web process."
        },
        {
          lane: "agent-safety",
          title: "Scoped read and planning APIs",
          summary: "Default external agents to read-only with explicit command gates."
        }
      ] as const;

      if (!input.lane) {
        return items;
      }

      return items.filter((item) => item.lane === input.lane);
    }),
  recentDeployments: protectedProcedure
    .input(
      z.object({
        status: z.enum(["healthy", "failed", "running", "queued"]).optional(),
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
      await ensureControlPlaneReady();
      return listDeploymentRecords(input.status, input.limit ?? 20);
    }),
  deploymentDetails: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1)
      })
    )
    .query(async ({ input }) => {
      await ensureControlPlaneReady();
      const deployment = getDeploymentRecord(input.deploymentId);

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment record not found."
        });
      }

      return deployment;
    }),
  createDeploymentRecord: deployProcedure
    .input(
      z.object({
        projectName: z.string().min(1).max(80),
        environmentName: z.string().min(1).max(80),
        serviceName: z.string().min(1).max(80),
        sourceType: z.enum(["compose", "dockerfile", "image"]),
        targetServerId: z.string().min(1),
        commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
        imageTag: z.string().min(1).max(160),
        steps: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              detail: z.string().min(1).max(280)
            })
          )
          .min(1)
          .max(6)
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ensureControlPlaneReady();
      const deployment = createDeploymentRecord({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target server not found."
        });
      }

      return deployment;
    }),
  agentTokenInventory: adminProcedure.query(async () => {
    await ensureControlPlaneReady();
    return listApiTokenInventory();
  }),
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
      "Terminal-style access is not part of the default control plane."
    ]
  }))
});

export type AppRouter = typeof appRouter;
