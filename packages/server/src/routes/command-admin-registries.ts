import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteContainerRegistry,
  registerContainerRegistry,
  updateContainerRegistry
} from "../db/services/container-registries";
import { getActorContext, serverWriteProcedure, t } from "../trpc";

const containerRegistryInputSchema = z.object({
  name: z.string().min(1).max(100),
  registryHost: z.string().min(1).max(255),
  username: z.string().min(1).max(255)
});

export const adminRegistryRouter = t.router({
  registerContainerRegistry: serverWriteProcedure
    .input(
      containerRegistryInputSchema.extend({
        password: z.string().min(1).max(4096)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRegistryInputValidation(() =>
        registerContainerRegistry({
          ...input,
          ...getActorContext(ctx)
        })
      );

      if (result.status === "not_found") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Registry could not be created."
        });
      }
      if (result.status === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: result.message });
      }

      return result.summary;
    }),

  updateContainerRegistry: serverWriteProcedure
    .input(
      containerRegistryInputSchema.extend({
        registryId: z.string().min(1),
        password: z.string().max(4096).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRegistryInputValidation(() =>
        updateContainerRegistry({
          ...input,
          ...getActorContext(ctx)
        })
      );

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({ code: "CONFLICT", message: result.message });
      }

      return result.summary;
    }),

  deleteContainerRegistry: serverWriteProcedure
    .input(z.object({ registryId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteContainerRegistry(input.registryId, getActorContext(ctx));
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found." });
      }

      return { deleted: true };
    })
});

async function withRegistryInputValidation<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Registry host")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message
      });
    }

    throw error;
  }
}
