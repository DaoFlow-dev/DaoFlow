import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createLogDrain,
  deleteLogDrain,
  retryLogDrainDelivery,
  testLogDrain
} from "../db/services/log-drains";
import {
  createManagedTunnel,
  deleteManagedTunnel,
  rotateManagedTunnelCredentials,
  syncManagedTunnelRoutes,
  updateManagedTunnel
} from "../db/services/tunnels";
import { getActorContext, serverOpsWriteProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

function notFound(message: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

const routeInput = z.object({
  hostname: z.string().min(1).max(255),
  service: z.string().min(1).max(255),
  path: z.string().max(255).optional().nullable(),
  status: z.enum(["active", "inactive", "error"]).optional()
});

export const adminManagedOperationsRouter = t.router({
  createManagedTunnel: serverOpsWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        tunnelId: z.string().max(80).optional().nullable(),
        domain: z.string().max(255).optional().nullable(),
        credentials: z.string().optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return createManagedTunnel({ ...input, teamId, actor: getActorContext(ctx) });
    }),

  updateManagedTunnel: serverOpsWriteProcedure
    .input(
      z.object({
        tunnelId: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        providerTunnelId: z.string().max(80).optional().nullable(),
        domain: z.string().max(255).optional().nullable(),
        status: z.enum(["active", "inactive", "error"]).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await updateManagedTunnel({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Managed tunnel not found.");
    }),

  syncManagedTunnelRoutes: serverOpsWriteProcedure
    .input(z.object({ tunnelId: z.string().min(1), routes: z.array(routeInput).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await syncManagedTunnelRoutes({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      return result ?? notFound("Managed tunnel not found.");
    }),

  rotateManagedTunnelCredentials: serverOpsWriteProcedure
    .input(z.object({ tunnelId: z.string().min(1), credentials: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await rotateManagedTunnelCredentials({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      return result ?? notFound("Managed tunnel not found.");
    }),

  deleteManagedTunnel: serverOpsWriteProcedure
    .input(z.object({ tunnelId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteManagedTunnel({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Managed tunnel not found.");
    }),

  createLogDrain: serverOpsWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        destinationType: z.enum(["webhook", "generic_http", "loki", "s3"]),
        endpointUrl: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
        serviceFilter: z.string().min(1).max(100).optional().nullable(),
        environmentFilter: z.string().min(1).max(100).optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return createLogDrain({ ...input, teamId, actor: getActorContext(ctx) });
    }),

  deleteLogDrain: serverOpsWriteProcedure
    .input(z.object({ drainId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteLogDrain({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Log drain not found.");
    }),

  testLogDrain: serverOpsWriteProcedure
    .input(z.object({ drainId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await testLogDrain({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Log drain not found.");
    }),

  retryLogDrainDelivery: serverOpsWriteProcedure
    .input(z.object({ deliveryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await retryLogDrainDelivery({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Log drain delivery not found.");
    })
});
