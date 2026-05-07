import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  collectServerResources,
  planServerPatches,
  previewServerCleanup,
  runServerCleanup
} from "../db/services/server-operations";
import {
  planNodeAvailability,
  planServiceScale,
  refreshSwarmTopology,
  updateNodeAvailability,
  updateServiceScale
} from "../db/services/server-swarm-operations";
import { getActorContext, serverReadProcedure, serverWriteProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

function throwServerOperationError(result: { status: string; message?: string }) {
  if (result.status === "not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
  }
  if (result.status === "preview_required") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: result.message ?? "Run a preview before executing this operation."
    });
  }
  if (result.status === "failed") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: result.message ?? "Server operation failed."
    });
  }
  if (result.status === "unsupported") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.message ?? "Unsupported server operation."
    });
  }
  if (result.status === "unsafe") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: result.message ?? "Unsafe server operation."
    });
  }
}

const serverIdInput = z.object({ serverId: z.string().min(1) });
const cleanupInput = serverIdInput.extend({
  includeVolumes: z.boolean().optional()
});
const nodeAvailabilityInput = serverIdInput.extend({
  node: z.string().min(1).max(120),
  availability: z.enum(["active", "pause", "drain"]),
  dryRun: z.boolean().optional()
});
const serviceScaleInput = serverIdInput.extend({
  service: z.string().min(1).max(180),
  replicas: z.number().int().min(0).max(100),
  dryRun: z.boolean().optional()
});

export const adminServerOperationsRouter = t.router({
  collectServerResources: serverReadProcedure
    .input(serverIdInput)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await collectServerResources({
        serverId: input.serverId,
        teamId,
        actor: getActorContext(ctx)
      });
      throwServerOperationError(result);
      return result;
    }),

  previewServerCleanup: serverWriteProcedure
    .input(cleanupInput)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await previewServerCleanup({
        serverId: input.serverId,
        teamId,
        includeVolumes: input.includeVolumes,
        actor: getActorContext(ctx)
      });
      throwServerOperationError(result);
      return result;
    }),

  runServerCleanup: serverWriteProcedure.input(cleanupInput).mutation(async ({ ctx, input }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    const result = await runServerCleanup({
      serverId: input.serverId,
      teamId,
      includeVolumes: input.includeVolumes,
      actor: getActorContext(ctx)
    });
    throwServerOperationError(result);
    return result;
  }),

  planServerPatches: serverWriteProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    const result = await planServerPatches({
      serverId: input.serverId,
      teamId,
      actor: getActorContext(ctx)
    });
    throwServerOperationError(result);
    return result;
  }),

  refreshSwarmTopology: serverWriteProcedure
    .input(serverIdInput)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await refreshSwarmTopology({
        serverId: input.serverId,
        teamId,
        actor: getActorContext(ctx)
      });
      throwServerOperationError(result);
      return result;
    }),

  updateSwarmNodeAvailability: serverWriteProcedure
    .input(nodeAvailabilityInput)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = input.dryRun
        ? await planNodeAvailability({ ...input, teamId, actor })
        : await updateNodeAvailability({ ...input, teamId, actor });
      throwServerOperationError(result);
      return result;
    }),

  updateSwarmServiceScale: serverWriteProcedure
    .input(serviceScaleInput)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = input.dryRun
        ? await planServiceScale({ ...input, teamId, actor })
        : await updateServiceScale({ ...input, teamId, actor });
      throwServerOperationError(result);
      return result;
    })
});
