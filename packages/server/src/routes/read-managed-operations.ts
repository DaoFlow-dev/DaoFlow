import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listLogDrainDeliveries, listLogDrains } from "../db/services/log-drains";
import { getManagedTunnel, listManagedTunnels } from "../db/services/tunnels";
import { serverReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const managedOperationsReadRouter = t.router({
  managedTunnels: serverReadProcedure.query(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    return listManagedTunnels(teamId);
  }),

  managedTunnel: serverReadProcedure
    .input(z.object({ tunnelId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const tunnel = await getManagedTunnel(teamId, input.tunnelId);
      if (!tunnel) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Managed tunnel not found." });
      }
      return tunnel;
    }),

  logDrains: serverReadProcedure.query(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    return listLogDrains(teamId);
  }),

  logDrainDeliveries: serverReadProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return listLogDrainDeliveries(teamId, input.limit ?? 50);
    })
});
