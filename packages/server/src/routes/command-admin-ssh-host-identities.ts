import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { verifyServerReadiness } from "../db/services/server-readiness";
import {
  approveServerSshHostIdentity,
  discoverServerSshHostIdentities,
  rotateServerSshHostIdentity
} from "../db/services/ssh-host-identities";
import { getActorContext, serverWriteProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

const exactHostKeySelection = z.object({
  serverId: z.string().min(1).max(32),
  identityId: z.string().min(1).max(32),
  algorithm: z.string().min(1).max(80),
  publicKey: z.string().min(1).max(20_000),
  fingerprint: z.string().min(1).max(128)
});

function throwForIdentityResult(status: string): never {
  if (status === "not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Server or SSH host identity not found." });
  }
  if (status === "rotation_required") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An SSH host key is already approved. Use the explicit rotation action."
    });
  }
  if (status === "approval_required") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approve an SSH host key before rotating it."
    });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "The selected SSH host key no longer exactly matches the discovered key."
  });
}

export const adminSshHostIdentityRouter = t.router({
  scanServerSshHostIdentities: serverWriteProcedure
    .input(z.object({ serverId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await discoverServerSshHostIdentities({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }
      return result;
    }),

  approveServerSshHostIdentity: serverWriteProcedure
    .input(exactHostKeySelection)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await approveServerSshHostIdentity({
        serverId: input.serverId,
        teamId,
        selection: input,
        actor: getActorContext(ctx)
      });
      if (result.status !== "approved") throwForIdentityResult(result.status);

      const server = await verifyServerReadiness(result.server);
      return { identity: result.identity, server };
    }),

  rotateServerSshHostIdentity: serverWriteProcedure
    .input(exactHostKeySelection)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await rotateServerSshHostIdentity({
        serverId: input.serverId,
        teamId,
        selection: input,
        actor: getActorContext(ctx)
      });
      if (result.status !== "rotated") throwForIdentityResult(result.status);

      const server = await verifyServerReadiness(result.server);
      return { oldIdentity: result.oldIdentity, identity: result.identity, server };
    })
});
