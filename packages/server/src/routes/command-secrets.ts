import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createSecretProvider,
  listSecretProviders,
  deleteSecretProvider,
  testProviderConnection,
  isValidSecretRef
} from "../db/services/onepassword";
import { t, adminProcedure, protectedProcedure, getActorContext } from "../trpc";

export const secretsRouter = t.router({
  /** Create a new secret provider (e.g. 1Password service account) */
  createSecretProvider: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        type: z.enum(["1password"]),
        serviceAccountToken: z.string().min(10)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);

      const provider = await createSecretProvider({
        name: input.name,
        type: input.type,
        serviceAccountToken: input.serviceAccountToken,
        teamId: "default",
        createdByUserId: actor.requestedByUserId,
        createdByEmail: actor.requestedByEmail
      });

      return provider;
    }),

  /** List all secret providers for the team */
  listSecretProviders: protectedProcedure.query(async () => {
    return listSecretProviders("default");
  }),

  /** Test a provider's connection */
  testSecretProvider: adminProcedure
    .input(z.object({ providerId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return testProviderConnection(input.providerId, "default");
    }),

  /** Delete a secret provider */
  deleteSecretProvider: adminProcedure
    .input(z.object({ providerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const deleted = await deleteSecretProvider(
        input.providerId,
        "default",
        actor.requestedByUserId,
        actor.requestedByEmail
      );

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret provider not found."
        });
      }

      return { deleted: true };
    }),

  /** Validate a secret reference format */
  validateSecretRef: protectedProcedure.input(z.object({ ref: z.string() })).query(({ input }) => {
    return {
      valid: isValidSecretRef(input.ref),
      ref: input.ref
    };
  })
});
