import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  attachManagedSshKeyToServer,
  createManagedSshKey,
  deleteManagedSshKey,
  detachManagedSshKeyFromServer,
  rotateManagedSshKey
} from "../db/services/access-assets";
import { createCertificateAsset, deleteCertificateAsset } from "../db/services/certificate-assets";
import { getActorContext, serverWriteProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

function notFound(message: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

export const adminAccessAssetsRouter = t.router({
  createManagedSshKey: serverWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        username: z.string().min(1).max(80).optional().nullable(),
        privateKey: z.string().min(1).max(50_000)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return createManagedSshKey({ ...input, teamId, actor: getActorContext(ctx) });
    }),

  rotateManagedSshKey: serverWriteProcedure
    .input(
      z.object({ keyId: z.string().min(1).max(32), privateKey: z.string().min(1).max(50_000) })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await rotateManagedSshKey({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Managed SSH key not found.");
    }),

  attachManagedSshKeyToServer: serverWriteProcedure
    .input(z.object({ keyId: z.string().min(1).max(32), serverId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await attachManagedSshKeyToServer({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      return result ?? notFound("Managed SSH key or server not found.");
    }),

  deleteManagedSshKey: serverWriteProcedure
    .input(z.object({ keyId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteManagedSshKey({ ...input, teamId, actor: getActorContext(ctx) });
      return result ?? notFound("Managed SSH key not found.");
    }),

  detachManagedSshKeyFromServer: serverWriteProcedure
    .input(z.object({ serverId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const result = await detachManagedSshKeyFromServer({
        ...input,
        actor: getActorContext(ctx)
      });
      return result ?? notFound("Server not found.");
    }),

  createCertificateAsset: serverWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        certificatePem: z.string().min(1).max(50_000),
        privateKey: z.string().max(50_000).optional().nullable(),
        caChain: z.string().max(100_000).optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return createCertificateAsset({ ...input, teamId, actor: getActorContext(ctx) });
    }),

  deleteCertificateAsset: serverWriteProcedure
    .input(z.object({ certificateId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteCertificateAsset({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      return result ?? notFound("Certificate asset not found.");
    })
});
