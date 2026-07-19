import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  buildExternalArtifactRestorePlan,
  getExternalBackupArtifact,
  listExternalBackupArtifacts,
  listExternalBackupObjects,
  registerExternalBackupArtifact,
  triggerExternalArtifactTestRestore
} from "../db/services/external-backup-artifacts";
import { backupReadProcedure, backupRestoreProcedure, getActorContext, t } from "../trpc";
import {
  assertBackupDestinationScope,
  assertExternalBackupArtifactScope,
  assertVolumeScope
} from "./backup-scope";
import { requireActorTeamId } from "./team-scope";

const destinationIdInput = z.object({ destinationId: z.string().min(1).max(32) });

export const externalBackupArtifactReadRouter = t.router({
  externalBackupObjects: backupReadProcedure
    .input(destinationIdInput.extend({ prefix: z.string().max(1024).optional() }))
    .query(async ({ ctx, input }) => {
      await assertBackupDestinationScope({
        ctx,
        destinationId: input.destinationId,
        action: "external-artifact.list.denied",
        permissionScope: "backup:read"
      });
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      try {
        return await listExternalBackupObjects({
          ...input,
          teamId,
          actor: {
            userId: actor.requestedByUserId,
            email: actor.requestedByEmail,
            role: actor.requestedByRole
          }
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "External backup objects are unavailable."
        });
      }
    }),
  externalBackupArtifacts: backupReadProcedure
    .input(
      destinationIdInput.partial().extend({ limit: z.number().int().min(1).max(100).optional() })
    )
    .query(async ({ ctx, input }) => {
      if (input.destinationId) {
        await assertBackupDestinationScope({
          ctx,
          destinationId: input.destinationId,
          action: "external-artifact.list.denied",
          permissionScope: "backup:read"
        });
      }
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return listExternalBackupArtifacts({ teamId, ...input });
    }),
  externalBackupArtifact: backupReadProcedure
    .input(z.object({ artifactId: z.string().min(1).max(32) }))
    .query(async ({ ctx, input }) => {
      await assertExternalBackupArtifactScope({
        ctx,
        artifactId: input.artifactId,
        action: "external-artifact.read.denied",
        permissionScope: "backup:read"
      });
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const artifact = await getExternalBackupArtifact(input.artifactId, teamId);
      if (!artifact)
        throw new TRPCError({ code: "NOT_FOUND", message: "External backup artifact not found." });
      return artifact;
    }),
  externalArtifactRestorePlan: backupReadProcedure
    .input(
      z.object({ artifactId: z.string().min(1).max(32), targetVolumeId: z.string().min(1).max(32) })
    )
    .query(async ({ ctx, input }) => {
      await assertExternalBackupArtifactScope({
        ctx,
        artifactId: input.artifactId,
        action: "external-artifact.restore-plan.denied",
        permissionScope: "backup:read"
      });
      await assertVolumeScope({
        ctx,
        volumeId: input.targetVolumeId,
        action: "external-artifact.restore-plan.denied",
        permissionScope: "backup:read"
      });
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const plan = await buildExternalArtifactRestorePlan({ teamId, ...input });
      if (!plan)
        throw new TRPCError({ code: "NOT_FOUND", message: "External restore target not found." });
      return plan;
    })
});

export const externalBackupArtifactCommandRouter = t.router({
  registerExternalBackupArtifact: backupRestoreProcedure
    .input(
      destinationIdInput.extend({
        objectKey: z.string().min(1).max(1024),
        postgresMajor: z.number().int().min(9).max(99)
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertBackupDestinationScope({
        ctx,
        destinationId: input.destinationId,
        action: "external-artifact.import.denied",
        permissionScope: "backup:restore"
      });
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      try {
        return await registerExternalBackupArtifact({
          ...input,
          postgresMajor: String(input.postgresMajor),
          teamId,
          actor: {
            userId: actor.requestedByUserId,
            email: actor.requestedByEmail,
            role: actor.requestedByRole
          }
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "External backup artifact could not be registered."
        });
      }
    }),
  triggerExternalArtifactTestRestore: backupRestoreProcedure
    .input(z.object({ artifactId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      await assertExternalBackupArtifactScope({
        ctx,
        artifactId: input.artifactId,
        action: "external-artifact.verify.denied",
        permissionScope: "backup:restore"
      });
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      try {
        return await triggerExternalArtifactTestRestore({
          ...input,
          teamId,
          actor: {
            userId: actor.requestedByUserId,
            email: actor.requestedByEmail,
            role: actor.requestedByRole
          }
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "External artifact verification could not be queued."
        });
      }
    })
});
