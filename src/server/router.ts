import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
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
    currentSlice: "foundation",
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
  viewer: protectedProcedure.query(({ ctx }) => ({
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
      intent: "human session auth for the control plane"
    }
  }))
});

export type AppRouter = typeof appRouter;
