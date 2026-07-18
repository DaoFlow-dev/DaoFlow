import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listServerSshHostIdentities } from "../db/services/ssh-host-identities";
import { serverReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const serverSshHostIdentityReadRouter = t.router({
  serverSshHostIdentities: serverReadProcedure
    .input(z.object({ serverId: z.string().min(1).max(32) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await listServerSshHostIdentities(input.serverId, teamId);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }
      return result;
    })
});
