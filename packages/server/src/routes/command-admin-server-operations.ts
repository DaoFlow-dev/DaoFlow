import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  collectServerResources,
  planServerPatches,
  previewServerCleanup,
  runServerCleanup
} from "../db/services/server-operations";
import { getActorContext, serverReadProcedure, serverWriteProcedure, t } from "../trpc";

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
}

const serverIdInput = z.object({ serverId: z.string().min(1) });
const cleanupInput = serverIdInput.extend({
  includeVolumes: z.boolean().optional()
});

export const adminServerOperationsRouter = t.router({
  collectServerResources: serverReadProcedure
    .input(serverIdInput)
    .mutation(async ({ ctx, input }) => {
      const result = await collectServerResources({
        serverId: input.serverId,
        actor: getActorContext(ctx)
      });
      throwServerOperationError(result);
      return result;
    }),

  previewServerCleanup: serverWriteProcedure
    .input(cleanupInput)
    .mutation(async ({ ctx, input }) => {
      const result = await previewServerCleanup({
        serverId: input.serverId,
        includeVolumes: input.includeVolumes,
        actor: getActorContext(ctx)
      });
      throwServerOperationError(result);
      return result;
    }),

  runServerCleanup: serverWriteProcedure.input(cleanupInput).mutation(async ({ ctx, input }) => {
    const result = await runServerCleanup({
      serverId: input.serverId,
      includeVolumes: input.includeVolumes,
      actor: getActorContext(ctx)
    });
    throwServerOperationError(result);
    return result;
  }),

  planServerPatches: serverWriteProcedure.input(serverIdInput).mutation(async ({ ctx, input }) => {
    const result = await planServerPatches({
      serverId: input.serverId,
      actor: getActorContext(ctx)
    });
    throwServerOperationError(result);
    return result;
  })
});
